import { format } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Badge, Button, Chip, EmptyState, Fare, Field, InterestPicker, PersonSummary, PressableScale, ScreenHeader,
  Skeleton, SkeletonRideCard,
  rideSeatsLabel, useInterestTags,
} from '@/components';
import { latLng } from '@/lib/geo';
import { formatTnd } from '@/lib/money';
import { CARD_SHADOW } from '@/lib/theme';
import { createBooking, listBookings, transitionBooking } from '@/services/bookings';
import { recordSponsorshipEvent } from '@/services/brands';
import {
  cancelRide, completeRide, getRide, rideCancellationQuote, startRide, updateRide, type RideUpdate,
} from '@/services/rides';
import { tagLabel } from '@/services/users';
import { useSession } from '@/store/session';
import {
  ATMOSPHERES, BOOKING_STEP_META, RIDE_UPCOMING, type Atmosphere, type Booking, type BookingAction, type BookingStatus, type Ride, type RideCancellationQuote,
} from '@/types';

const NOTES_MAX = 500;

// Requests first, then seats already held, then finished or dropped bookings.
const ACTIVE_BOOKING: BookingStatus[] = ['REQUESTED', 'ACCEPTED', 'CONFIRMED'];

const PASSENGER_ORDER: BookingStatus[] = [
  'REQUESTED', 'ACCEPTED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW', 'REJECTED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER',
];

type PassengerAction = { label: string; transition: BookingAction; variant: 'primary' | 'danger' };

function passengerActions(booking: Booking, ride: Ride): PassengerAction[] {
  if (booking.status === 'REQUESTED' && RIDE_UPCOMING.includes(ride.status)) {
    const reject: PassengerAction = { label: 'Reject', transition: 'reject', variant: 'danger' };
    return ride.status === 'OPEN' ? [{ label: 'Accept', transition: 'accept', variant: 'primary' }, reject] : [reject];
  }
  if (booking.status === 'CONFIRMED' && ride.status === 'IN_PROGRESS') {
    return [
      { label: 'Complete', transition: 'complete', variant: 'primary' },
      { label: 'No show', transition: 'no_show', variant: 'danger' },
    ];
  }
  return [];
}

function statusTone(status: BookingStatus): 'accent' | 'warning' | 'deal' | 'neutral' {
  if (status === 'REQUESTED') return 'warning';
  if (status === 'ACCEPTED' || status === 'CONFIRMED') return 'accent';
  return status === 'COMPLETED' ? 'neutral' : 'deal';
}

interface EditDraft {
  departure: string;
  seats: string;
  price: string;
  notes: string;
  atmosphere: Atmosphere | '';
  preferred: string[];
}

const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((slug) => b.includes(slug));

const draftFrom = (ride: Ride): EditDraft => ({
  departure: format(new Date(ride.departure_at), 'yyyy-MM-dd HH:mm'),
  seats: String(ride.seats_total),
  price: ride.price_per_seat,
  notes: ride.notes ?? '',
  atmosphere: ride.atmosphere ?? '',
  preferred: ride.preferred_interests ?? [],
});

/** Ride detail: route, seats, fare and notes; booking for passengers, lifecycle controls for its driver. */
export default function RideDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useSession((s) => s.user);
  const { tags } = useInterestTags();
  const canBook = user?.role === 'PASSENGER';
  // undefined = still loading, null = not found, Ride = loaded.
  const [ride, setRide] = useState<Ride | null | undefined>(undefined);
  const [seats, setSeats] = useState('1');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [cancelPreview, setCancelPreview] = useState<RideCancellationQuote | null>(null);
  // Only loaded for the ride's driver.
  const [passengers, setPassengers] = useState<Booking[] | undefined>(undefined);
  const [myBooking, setMyBooking] = useState<Booking>();
  const [passengerError, setPassengerError] = useState('');
  const [actingOn, setActingOn] = useState<string | null>(null);
  const userId = user?.id;

  // The sponsor discount is quoted per seat and applied by the ledger when the
  // booking is confirmed; the preview here only mirrors what the passenger will pay.
  const sponsorDiscount = ride?.sponsorship?.active ? Number(ride.sponsorship.discount_per_seat) : 0;
  const seatCount = Number(seats);
  const validSeats = Number.isInteger(seatCount) && seatCount > 0 ? seatCount : 0;
  const fareTotal = (Number(ride?.price_per_seat) || 0) * validSeats;
  const fareAfterSponsor = Math.max(0, fareTotal - sponsorDiscount * validSeats);

  const load = useCallback(() => {
    getRide(id)
      .then((r) => {
        setRide(r);
        if (canBook) {
          // Labeled sponsored content was seen: report the impression (deduped server-side).
          if (r.sponsorship?.active) void recordSponsorshipEvent(r.id, 'IMPRESSION').catch(() => undefined);
          return listBookings({ ride: r.id })
            .then((page) => setMyBooking(page.results.find((b) => ACTIVE_BOOKING.includes(b.status))))
            .catch(() => undefined);
        }
        if (r.driver !== userId) return;
        return listBookings({ ride: r.id })
          .then((page) => setPassengers(page.results))
          .catch(() => setPassengerError('Passenger requests could not load. Reopen this ride to try again.'));
      })
      .catch(() => setRide(null));
  }, [id, userId, canBook]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<Ride>, fallback: string) => {
    setBusy(true);
    setError('');
    try {
      setRide(await work());
      setDraft(null);
      setCancelPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const book = async () => {
    if (!ride) return;
    const count = Number(seats);
    if (!Number.isInteger(count) || count < 1 || count > ride.seats_available) {
      setError(`Choose 1–${ride.seats_available} seats`);
      return;
    }
    // Pickup/dropoff default to the ride's origin/destination for now.
    const origin = latLng(ride.origin);
    const destination = latLng(ride.destination);
    if (!origin || !destination) {
      setError('This ride has no usable coordinates');
      return;
    }
    setError('');
    setBusy(true);
    try {
      // Booking a sponsored ride is the engagement the brand pays for.
      if (ride.sponsorship?.active) void recordSponsorshipEvent(ride.id, 'ENGAGEMENT').catch(() => undefined);
      const created = await createBooking({ ride: ride.id, seats: count, pickup: origin, dropoff: destination });
      router.replace(`/booking/${created.id}` as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = () => {
    if (!ride || !draft) return;
    const patch: RideUpdate = {};
    const departure = new Date(draft.departure);
    if (Number.isNaN(departure.getTime())) return setError('Departure must look like 2026-11-20 08:30');
    if (draft.departure !== draftFrom(ride).departure) patch.departure_at = departure.toISOString();
    const seatsTotal = Number(draft.seats);
    if (!Number.isInteger(seatsTotal) || seatsTotal < 1) return setError('Seats offered must be at least 1');
    if (seatsTotal !== ride.seats_total) patch.seats_total = seatsTotal;
    if (!/^\d+(\.\d{1,3})?$/.test(draft.price.trim())) return setError('Price must be a TND amount, e.g. 12.500');
    if (Number(draft.price) !== Number(ride.price_per_seat)) patch.price_per_seat = draft.price.trim();
    if (draft.notes.length > NOTES_MAX) return setError(`Notes are limited to ${NOTES_MAX} characters`);
    if (draft.notes !== (ride.notes ?? '')) patch.notes = draft.notes;
    if (draft.atmosphere !== (ride.atmosphere ?? '')) patch.atmosphere = draft.atmosphere;
    if (!sameTags(draft.preferred, ride.preferred_interests ?? [])) patch.preferred_interests = draft.preferred;
    if (Object.keys(patch).length === 0) return setDraft(null);
    void run(() => updateRide(ride.id, patch), 'Could not save the ride');
  };

  const actOnBooking = async (booking: Booking, transition: BookingAction) => {
    if (!ride) return;
    setActingOn(booking.id);
    setPassengerError('');
    try {
      const updated = await transitionBooking(booking.id, transition);
      setPassengers((prev) => prev?.map((b) => (b.id === updated.id ? updated : b)));
      // Accepting holds seats and can fill the ride, so seat count and status move too.
      setRide(await getRide(ride.id));
    } catch (err) {
      setPassengerError(err instanceof Error ? err.message : 'That action didn’t go through. Refresh and try again.');
    } finally {
      setActingOn(null);
    }
  };

  const previewCancel = async () => {
    if (!ride) return;
    setBusy(true);
    setError('');
    try {
      setCancelPreview(await rideCancellationQuote(ride.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the cancellation details');
    } finally {
      setBusy(false);
    }
  };

  if (ride === undefined) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader />
        <View className="mt-4 gap-3 px-5">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-28 w-full" />
          <SkeletonRideCard />
          <Skeleton className="h-24 w-full" />
        </View>
      </SafeAreaView>
    );
  }

  if (ride === null) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="Ride" />
        <EmptyState icon="map-outline" title="Ride not found" message="It may have been cancelled." />
      </SafeAreaView>
    );
  }

  const owns = ride.driver === user?.id;
  const upcoming = RIDE_UPCOMING.includes(ride.status);
  const bookable = ride.status === 'OPEN' && ride.seats_available > 0;
  const sortedPassengers = passengers
    ? [...passengers].sort((a, b) => PASSENGER_ORDER.indexOf(a.status) - PASSENGER_ORDER.indexOf(b.status))
    : undefined;
  const waiting = passengers?.filter((b) => b.status === 'REQUESTED').length ?? 0;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title="Ride details" />

      <ScrollView contentContainerClassName="pb-8" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View
          style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
          className="mx-5 mt-2 rounded-card bg-surface p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-meta text-muted">
              {format(new Date(ride.departure_at), 'EEEE d MMMM · HH:mm')}
            </Text>
            <Badge
              label={ride.status.replace('_', ' ')}
              tone={ride.status === 'OPEN' ? 'accent' : ride.status === 'CANCELLED' ? 'deal' : 'warning'}
              size="sm"
            />
          </View>

          <View className="mt-3 flex-row items-center gap-3">
            <View className="items-center py-1.5">
              <View className="h-3 w-3 rounded-full border-2 border-fg bg-surface" />
              <View className="my-1 w-0.5 h-10 bg-line" />
              <View className="h-3 w-3 rounded-full bg-accent" />
            </View>
            <View className="flex-1 gap-2">
              <Text className="font-bold text-h text-fg">{ride.origin_label}</Text>
              <Text className="font-bold text-h text-fg">{ride.destination_label}</Text>
            </View>
          </View>

          <View className="mt-3 flex-row flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3">
            {ride.distance_km != null ? <Text className="text-meta text-muted">{ride.distance_km} km</Text> : null}
            <Text className="text-meta text-muted">{rideSeatsLabel(ride)}</Text>
            {ride.vehicle_summary ? (
              <Text className="text-meta text-muted">
                {[ride.vehicle_summary.color, ride.vehicle_summary.make, ride.vehicle_summary.model].filter(Boolean).join(' ')}
              </Text>
            ) : null}
          </View>

          {!owns && ride.driver_summary ? (
            <View className="mt-3 border-t border-line pt-3">
              <Text className="mb-1 font-semibold text-meta text-muted">Driver</Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Open the profile of ${ride.driver_summary.display_name}`}
                onPress={() => router.push(`/user/${ride.driver_summary.id}` as never)}>
                <PersonSummary summary={ride.driver_summary} />
                <Text className="pl-6 pt-0.5 text-meta text-accentStrong">View profile and reviews</Text>
              </PressableScale>
            </View>
          ) : null}

          {ride.atmosphere || ride.preferred_interests?.length ? (
            <View className="mt-3 gap-1 border-t border-line pt-3">
              {ride.atmosphere ? (
                <Text className="text-body text-fg">{ATMOSPHERES.find((a) => a.value === ride.atmosphere)?.label}</Text>
              ) : null}
              {ride.preferred_interests?.length ? (
                <Text className="text-meta text-muted">
                  {`Enjoys talking about ${ride.preferred_interests.map((slug) => tagLabel(slug, tags)).join(', ')}`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {ride.notes ? (
            <Text className="mt-3 border-t border-line pt-3 text-body text-fg">{ride.notes}</Text>
          ) : null}
        </View>

        <View
          style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
          className="mx-5 mt-3 rounded-card bg-surface p-4">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="font-semibold text-meta text-muted">Price per seat</Text>
              <Fare amount={ride.price_per_seat} size="lg" tone="accent" className="mt-0.5" />
            </View>
            {!owns ? (
              <View className="items-end">
                <Text className="font-semibold text-meta text-muted">Fare</Text>
                <Text className="mt-0.5 font-bold tabular-nums text-h text-fg">
                  {ride.price_per_seat && !Number.isNaN(Number(seats))
                    ? `${fareAfterSponsor.toFixed(3)} TND`
                    : '—'}
                </Text>
                {sponsorDiscount > 0 && ride.price_per_seat && !Number.isNaN(Number(seats)) ? (
                  <Text className="text-meta text-faint">{`${fareTotal.toFixed(3)} before sponsor discount`}</Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Labeled sponsored content — the brand never sees who is on the ride. */}
          {ride.sponsorship?.active ? (
            <View className="mt-3 gap-1 border-t border-line pt-3">
              <View className="flex-row items-center gap-1.5">
                <Badge label="Sponsored" tone="soft" size="sm" />
                <Text numberOfLines={1} className="flex-1 text-meta text-muted">
                  {ride.sponsorship.brand_name}
                </Text>
              </View>
              <Text className="text-body text-fg">
                {`${formatTnd(ride.sponsorship.discount_per_seat)} off each seat`}
              </Text>
              {ride.sponsorship.title ? (
                <Text className="text-meta text-muted">{ride.sponsorship.title}</Text>
              ) : null}
              {ride.sponsorship.body ? (
                <Text className="text-meta text-faint">{ride.sponsorship.body}</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {error ? (
          <Text accessibilityRole="alert" className="mx-5 mt-3 text-center text-meta text-deal">{error}</Text>
        ) : null}

        {owns ? (
          <View className="mx-5 mt-3 gap-3">
            {upcoming && draft ? (
              <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="gap-3 rounded-card bg-surface p-4">
                <Text className="font-semibold text-title text-fg">Edit ride</Text>
                <Field label="Departure (YYYY-MM-DD HH:MM)" icon="time-outline" value={draft.departure} onChangeText={(t) => setDraft({ ...draft, departure: t })} />
                <Field label="Seats offered" icon="people-outline" keyboardType="number-pad" value={draft.seats} onChangeText={(t) => setDraft({ ...draft, seats: t.replace(/\D/g, '') })} />
                <Field label="Price per seat (TND)" icon="cash-outline" keyboardType="decimal-pad" value={draft.price} onChangeText={(t) => setDraft({ ...draft, price: t })} />
                <Field
                  label={`Notes for passengers (${draft.notes.length}/${NOTES_MAX})`}
                  icon="document-text-outline"
                  value={draft.notes}
                  onChangeText={(t) => setDraft({ ...draft, notes: t.slice(0, NOTES_MAX) })}
                  placeholder="Meeting point, luggage, stops…"
                  multiline
                />
                <Text className="font-semibold text-meta text-muted">Ride atmosphere</Text>
                <View className="flex-row flex-wrap gap-2">
                  {ATMOSPHERES.map((a) => (
                    <PressableScale
                      key={a.value}
                      accessibilityRole="radio"
                      accessibilityLabel={a.label}
                      accessibilityState={{ checked: draft.atmosphere === a.value }}
                      onPress={() => setDraft({ ...draft, atmosphere: draft.atmosphere === a.value ? '' : a.value })}>
                      <Chip label={a.label} selected={draft.atmosphere === a.value} size="sm" />
                    </PressableScale>
                  ))}
                </View>
                <Text className="font-semibold text-meta text-muted">Topics you enjoy on the road</Text>
                <InterestPicker selected={draft.preferred} onChange={(preferred) => setDraft({ ...draft, preferred })} disabled={busy} />
                <Text className="text-meta text-faint">
                  Route, departure and price are locked while a booking is pending or paid. Seats can’t drop below those already held.
                </Text>
                <View className="flex-row gap-2">
                  <Button className="flex-1" title="Discard" variant="secondary" disabled={busy} onPress={() => setDraft(null)} />
                  <Button className="flex-1" title="Save changes" loading={busy} onPress={saveEdit} />
                </View>
              </View>
            ) : null}

            {upcoming && !draft && !cancelPreview ? (
              <>
                <Button title="Start ride" icon="navigate-outline" loading={busy} onPress={() => void run(() => startRide(ride.id), 'Could not start the ride')} block />
                <Text className="text-center text-meta text-faint">
                  Accept or reject every pending request first. Unpaid accepted bookings must be paid or cancelled.
                </Text>
                <Button title="Edit ride" variant="secondary" icon="create-outline" disabled={busy} onPress={() => setDraft(draftFrom(ride))} block />
                <Button title="Cancel ride…" variant="danger" disabled={busy} onPress={() => void previewCancel()} block />
              </>
            ) : null}

            {cancelPreview ? (
              <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="rounded-card bg-surface p-4">
                <Text className="font-semibold text-title text-fg">Cancel this ride?</Text>
                {cancelPreview.allowed ? (
                  <View className="mt-2 gap-1">
                    <Text className="text-body text-fg">
                      {cancelPreview.bookings_cancelled === 0
                        ? 'No passenger has booked yet.'
                        : `${cancelPreview.bookings_cancelled} booking${cancelPreview.bookings_cancelled > 1 ? 's' : ''} will be cancelled.`}
                    </Text>
                    {cancelPreview.paid_bookings > 0 ? (
                      <Text className="text-body text-fg">
                        {formatTnd(cancelPreview.total_refund)} goes back to {cancelPreview.paid_bookings} paying passenger
                        {cancelPreview.paid_bookings > 1 ? 's' : ''}, taken from what this ride paid you.
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Text className="mt-2 text-body text-muted">This ride can no longer be cancelled.</Text>
                )}
                <View className="mt-3 flex-row gap-2">
                  <Button className="flex-1" title="Keep ride" variant="secondary" disabled={busy} onPress={() => setCancelPreview(null)} />
                  {cancelPreview.allowed ? (
                    <Button className="flex-1" title="Cancel ride" variant="danger" loading={busy} onPress={() => void run(() => cancelRide(ride.id), 'Could not cancel the ride')} />
                  ) : null}
                </View>
              </View>
            ) : null}

            {ride.status === 'IN_PROGRESS' ? (
              <>
                <Button title="Complete ride" icon="ribbon-outline" loading={busy} onPress={() => void run(() => completeRide(ride.id), 'Could not complete the ride')} block />
                <Text className="text-center text-meta text-faint">
                  Every paid booking is marked completed. Mark no-shows from the booking first.
                </Text>
              </>
            ) : null}

            {passengers || passengerError ? (
              <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="rounded-card bg-surface p-4">
                <Text accessibilityRole="header" className="font-semibold text-title text-fg">
                  Passengers{waiting > 0 ? ` · ${waiting} waiting for your answer` : ''}
                </Text>
                {passengers && passengers.length === 0 ? (
                  <Text className="mt-2 text-body text-muted">No requests yet. Passengers who ask for a seat appear here.</Text>
                ) : null}
                {(sortedPassengers ?? []).map((booking) => {
                  const actions = passengerActions(booking, ride);
                  const name = booking.passenger_summary.display_name;
                  return (
                    <View key={booking.id} className="mt-3 border-t border-line pt-3">
                      <PressableScale
                        accessibilityRole="button"
                        accessibilityLabel={`Open booking for ${name}`}
                        onPress={() => router.push(`/booking/${booking.id}` as never)}>
                        <View className="flex-row items-start justify-between gap-2">
                          <PersonSummary summary={booking.passenger_summary} className="flex-1" />
                          <Badge
                            label={BOOKING_STEP_META[booking.status]?.label ?? booking.status}
                            tone={statusTone(booking.status)}
                            size="sm"
                          />
                        </View>
                        <Text className="mt-1 text-meta text-muted">
                          {booking.seats} seat{booking.seats > 1 ? 's' : ''} · {formatTnd(booking.fare_amount)}
                        </Text>
                      </PressableScale>
                      {actions.length > 0 ? (
                        <View className="mt-2 flex-row justify-end gap-2">
                          {actions.map((action) => (
                            <Button
                              key={action.label}
                              title={action.label}
                              size="sm"
                              variant={action.variant}
                              accessibilityLabel={`${action.label} ${name}`}
                              loading={actingOn === booking.id}
                              disabled={actingOn !== null && actingOn !== booking.id}
                              onPress={() => void actOnBooking(booking, action.transition)}
                            />
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                {passengerError ? (
                  <Text accessibilityRole="alert" className="mt-2 text-body text-deal">{passengerError}</Text>
                ) : null}
              </View>
            ) : null}

            {ride.status === 'COMPLETED' || ride.status === 'CANCELLED' ? (
              <View className="rounded-card bg-accentSoft p-4">
                <Text className="text-center text-body font-medium text-accentStrong">
                  {ride.status === 'COMPLETED'
                    ? `Completed${ride.completed_at ? ` ${format(new Date(ride.completed_at), 'd MMM · HH:mm')}` : ''}.`
                    : `Cancelled${ride.cancelled_at ? ` ${format(new Date(ride.cancelled_at), 'd MMM · HH:mm')}` : ''}. Paid passengers were refunded.`}
                </Text>
              </View>
            ) : null}
          </View>
        ) : canBook && myBooking ? (
          <View className="mx-5 mt-3 gap-3 rounded-card bg-accentSoft p-4">
            <Text className="text-center text-body font-medium text-accentStrong">
              You already have a booking on this ride · {BOOKING_STEP_META[myBooking.status].label}
            </Text>
            <Button title="Open my booking" icon="ticket-outline" onPress={() => router.push(`/booking/${myBooking.id}` as never)} block />
          </View>
        ) : canBook && bookable ? (
          <View className="mx-5 mt-3 gap-3">
            <Field
              label={`Seats (1–${ride.seats_available})`}
              icon="people-outline"
              keyboardType="number-pad"
              value={seats}
              onChangeText={(t) => setSeats(t.replace(/\D/g, '').slice(0, 1) || '1')}
            />
            <Button title="Request booking" icon="checkmark-circle-outline" loading={busy} onPress={() => void book()} block />
            <Text className="text-center text-meta text-faint">
              Nothing is charged now. Once the driver accepts, you review the total and pay to confirm.
            </Text>
          </View>
        ) : (
          <View className="mx-5 mt-3 rounded-card bg-accentSoft p-4">
            <Text className="text-center text-body font-medium text-accentStrong">
              {!bookable
                ? 'This ride is not open for booking.'
                : user?.role === 'DRIVER'
                  ? 'Drivers cannot book rides — publish your own instead.'
                  : 'Only passenger accounts can book rides.'}
            </Text>
          </View>
        )}

        {!owns && user ? (
          <Button
            title="Report this ride"
            icon="flag-outline"
            variant="ghost"
            size="sm"
            className="mx-5 mt-4 self-start"
            onPress={() =>
              router.push({
                pathname: '/report',
                params: {
                  type: 'RIDE',
                  id: ride.id,
                  label: `${ride.origin_label} → ${ride.destination_label}`,
                },
              })
            }
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
