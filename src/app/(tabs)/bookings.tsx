import { format } from 'date-fns';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, EmptyState, Fare, PersonSummary, PressableScale, SkeletonRow } from '@/components';
import { cn } from '@/lib/cn';
import { CARD_SHADOW } from '@/lib/theme';
import { listBookings, transitionBooking } from '@/services/bookings';
import { getRide } from '@/services/rides';
import { useSession } from '@/store/session';
import { BOOKING_STEP_META, RIDE_UPCOMING, type Booking, type BookingAction, type BookingStatus, type Ride } from '@/types';

type Action = { label: string; variant: 'primary' | 'danger' } & ({ transition: BookingAction } | { opensDetail: true });

/** In-list shortcuts. Anything that moves money opens the booking screen, which shows the amounts first. */
function actionsFor(booking: Booking, ride: Ride | null | undefined, userId: string | undefined): Action[] {
  if (!ride) return [];
  if (ride.driver === userId) {
    if (booking.status === 'REQUESTED' && RIDE_UPCOMING.includes(ride.status)) {
      return [
        ...(ride.status === 'OPEN' ? [{ label: 'Accept', transition: 'accept', variant: 'primary' } as const] : []),
        { label: 'Reject', transition: 'reject', variant: 'danger' },
      ];
    }
    if (booking.status === 'CONFIRMED' && ride.status === 'IN_PROGRESS') {
      return [
        { label: 'Complete', transition: 'complete', variant: 'primary' },
        { label: 'No show', transition: 'no_show', variant: 'danger' },
      ];
    }
    return [];
  }
  if (booking.passenger === userId && booking.status === 'ACCEPTED') {
    return [{ label: 'Review and pay', opensDetail: true, variant: 'primary' }];
  }
  return [];
}

const TONE: Record<BookingStatus, 'accent' | 'warning' | 'deal' | 'neutral'> = {
  REQUESTED: 'warning',
  ACCEPTED: 'accent',
  CONFIRMED: 'accent',
  COMPLETED: 'neutral',
  REJECTED: 'deal',
  CANCELLED_BY_PASSENGER: 'deal',
  CANCELLED_BY_DRIVER: 'deal',
  NO_SHOW: 'deal',
};

export default function BookingsScreen() {
  const userId = useSession((s) => s.user?.id);
  // undefined = still loading; [] = loaded and empty.
  const [bookings, setBookings] = useState<Booking[] | undefined>(undefined);
  const [rideById, setRideById] = useState<Record<string, Ride | null>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const loading = bookings === undefined;

  const load = useCallback(() => {
    listBookings()
      .then(async (page) => {
        // The booking payload carries the ride id only — hydrate the route
        // summaries for the cards (failures just fall back to the id).
        const ids = [...new Set(page.results.map((b) => b.ride))];
        const rides = await Promise.all(ids.map((id) => getRide(id).catch(() => null)));
        setBookings(page.results);
        setRideById(Object.fromEntries(ids.map((id, i) => [id, rides[i]])));
      })
      .catch(() => setBookings([]));
  }, []);

  // Refetch on focus: bookings change from the ride and booking screens.
  useFocusEffect(load);

  const act = async (booking: Booking, transition: BookingAction) => {
    setBusyId(booking.id);
    setErrorById((prev) => ({ ...prev, [booking.id]: '' }));
    try {
      const updated = await transitionBooking(booking.id, transition);
      // Terminal statuses (rejected, cancelled, no-show) stay listed with their
      // badge, so no refetch is needed — the transition returns the new state.
      setBookings((prev) => prev?.map((b) => (b.id === updated.id ? updated : b)) ?? prev);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'That action didn’t go through. Refresh and try again.';
      setErrorById((prev) => ({ ...prev, [booking.id]: message }));
    } finally {
      setBusyId(null);
    }
  };

  const renderBooking = (booking: Booking) => {
    const ride = rideById[booking.ride];
    // Ownership decides the action set, not the account role: a driver also
    // books rides as a passenger, and vice versa.
    const drives = ride?.driver === userId;
    const isPassenger = booking.passenger === userId;
    const actions = actionsFor(booking, ride, userId);
    const error = errorById[booking.id];
    const meta = BOOKING_STEP_META[booking.status];
    const ownership = drives ? ' · you drive' : isPassenger ? ' · your trip' : '';

    return (
      <PressableScale
        onPress={() => router.push(`/booking/${booking.id}` as never)}
        style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
        className="rounded-card bg-surface p-4">
        <View className="flex-row items-center justify-between gap-2">
          <Text numberOfLines={1} className="flex-1 font-semibold text-meta text-muted">
            {ride ? `${ride.origin_label} → ${ride.destination_label}` : `Ride ${booking.ride.slice(0, 8)}`}
          </Text>
          <View style={{ flexShrink: 0 }}>
            <Badge label={meta?.label ?? booking.status} tone={TONE[booking.status]} size="sm" />
          </View>
        </View>
        <View className="mt-2 flex-row items-center justify-between gap-2">
          <Text numberOfLines={1} className="flex-1 font-semibold text-title text-fg">
            {booking.seats} seat{booking.seats > 1 ? 's' : ''}
            {ride ? ` · ${format(new Date(ride.departure_at), 'EEE d MMM HH:mm')}` : ''}
          </Text>
          <View style={{ flexShrink: 0 }}>
            <Fare amount={booking.fare_amount} size="md" tone="accent" />
          </View>
        </View>
        {meta ? (
          <Text className="mt-1 text-body text-muted">
            {meta.hint}
            <Text className="text-faint">{ownership}</Text>
          </Text>
        ) : null}
        {drives ? <PersonSummary summary={booking.passenger_summary} className="mt-2" /> : null}

        {actions.length > 0 ? (
          <View className="mt-3 flex-row justify-end gap-2 border-t border-line pt-3">
            {actions.map((action) => (
              <PressableScale
                key={action.label}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                disabled={busyId === booking.id}
                onPress={() =>
                  'transition' in action
                    ? void act(booking, action.transition)
                    : router.push(`/booking/${booking.id}` as never)
                }
                className={cn(
                  'h-9 items-center justify-center rounded-pill px-4',
                  action.variant === 'primary' ? 'bg-accent' : 'bg-deal/10',
                )}>
                <Text className={cn('font-semibold text-body', action.variant === 'primary' ? 'text-onAccent' : 'text-deal')}>
                  {action.label}
                </Text>
              </PressableScale>
            ))}
          </View>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="mt-2 text-body text-deal">
            {error}
          </Text>
        ) : null}
      </PressableScale>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-5 pt-3">
        <Text className="text-display font-bold text-fg">Bookings</Text>
      </View>
      {loading ? (
        <View className="gap-3 px-5">
          {[0, 1, 2].map((key) => (
            <SkeletonRow key={key} />
          ))}
        </View>
      ) : bookings.length === 0 ? (
        <EmptyState
          icon="albums-outline"
          title="No bookings"
          message="Your ride bookings will appear here — both as passenger and driver."
          actionLabel="Find a ride"
          onAction={() => router.push('/(tabs)/rides')}
        />
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(b) => b.id}
          contentContainerClassName="gap-3 px-5 pb-24 pt-3"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => renderBooking(item)}
        />
      )}
    </SafeAreaView>
  );
}
