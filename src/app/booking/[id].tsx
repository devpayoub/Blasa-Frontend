import { format } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookingStepper, Button, EmptyState, Fare, Field, ScreenHeader, Skeleton, Badge } from '@/components';
import { formatTnd } from '@/lib/money';
import { CARD_SHADOW } from '@/lib/theme';
import { cancellationQuote, confirmBooking, getBooking, paymentQuote, transitionBooking } from '@/services/bookings';
import { listConversations } from '@/services/conversations';
import { createRating } from '@/services/ratings';
import { getRide } from '@/services/rides';
import { useSession } from '@/store/session';
import {
  BOOKING_STEP_META, RIDE_UPCOMING,
  type Booking, type BookingAction, type BookingStatus, type CancellationQuote, type PaymentQuote, type Ride,
} from '@/types';

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

const ACTIVE: BookingStatus[] = ['REQUESTED', 'ACCEPTED', 'CONFIRMED'];

const positive = (amount: string | null | undefined) => Number(amount ?? 0) > 0;

function Line({ label, amount, minus, strong }: { label: string; amount: string; minus?: boolean; strong?: boolean }) {
  return (
    <View className="flex-row items-center justify-between gap-2 py-1">
      <Text className={strong ? 'flex-1 font-semibold text-title text-fg' : 'flex-1 text-body text-muted'}>{label}</Text>
      <Text className={strong ? 'font-bold tabular-nums text-title text-fg' : 'tabular-nums text-body text-fg'}>
        {minus ? `− ${formatTnd(amount)}` : formatTnd(amount)}
      </Text>
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="rounded-card bg-surface p-4">
      {children}
    </View>
  );
}

/** Booking detail: tracking timeline, pay-to-confirm, cancellation preview, review after completion. */
export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useSession((s) => s.user?.id);
  // undefined = still loading, null = not found, Booking = loaded.
  const [booking, setBooking] = useState<Booking | null | undefined>(undefined);
  const [ride, setRide] = useState<Ride | null>(null);
  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [cancelPreview, setCancelPreview] = useState<CancellationQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rated, setRated] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatScope = useRef({ key: `${userId}:${id}`, mounted: false, pending: false });

  useEffect(() => {
    const scope = chatScope.current;
    scope.key = `${userId}:${id}`;
    scope.mounted = true;
    return () => { scope.mounted = false; };
  }, [id, userId]);

  const openChat = async () => {
    const session = useSession.getState();
    if (!booking || booking.id !== id || !session.access || session.user?.id !== userId || chatScope.current.pending) return;
    const scope = `${userId}:${id}`;
    const current = () => chatScope.current.mounted && chatScope.current.key === scope && useSession.getState().user === session.user;
    chatScope.current.pending = true;
    setChatBusy(true);
    setError('');
    try {
      // Follow owned page numbers, never an API-provided external next URL.
      for (let number = 1; number <= 100; number += 1) {
        const page = await listConversations(number);
        if (!current()) return;
        const conversation = page.results.find((item) => item.booking === booking.id);
        if (conversation) { router.push(`/chat/${conversation.id}` as never); return; }
        if (!page.next) break;
      }
      if (current()) setError('Chat is unavailable. It only unlocks after payment confirmation.');
    } catch (err) {
      if (current()) setError(err instanceof Error ? err.message : 'Could not open chat. Try again.');
    } finally {
      chatScope.current.pending = false;
      if (chatScope.current.mounted) setChatBusy(false);
    }
  };

  const load = useCallback(
    () =>
      getBooking(id)
        .then(async (b) => {
          // Resolve the ride first so ownership (and thus the action set) is
          // known by the time the screen renders.
          const r = await getRide(b.ride).catch(() => null);
          const q = b.status === 'ACCEPTED' && b.passenger === userId ? await paymentQuote(b.id).catch(() => null) : null;
          setRide(r);
          setQuote(q);
          setBooking(b);
        })
        .catch(() => setBooking(null)),
    [id, userId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError('');
    try {
      await work();
      setCancelPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      // Always re-read: a refused payment may mean the total changed server-side.
      await load();
      setBusy(false);
    }
  };

  const act = (action: BookingAction) => booking && run(() => transitionBooking(booking.id, action), 'Action failed');
  const pay = () => booking && quote && run(() => confirmBooking(booking.id, quote.out_of_pocket), 'Payment failed');

  const previewCancel = async () => {
    if (!booking) return;
    setBusy(true);
    setError('');
    try {
      setCancelPreview(await cancellationQuote(booking.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the cancellation details');
    } finally {
      setBusy(false);
    }
  };

  const rate = async (score: number) => {
    if (!booking) return;
    setBusy(true);
    setError('');
    try {
      await createRating(booking.id, score, comment.trim() || undefined);
      setRated(score);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rating failed');
    } finally {
      setBusy(false);
    }
  };

  if (booking === undefined) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader />
        <View className="mt-4 gap-3 px-5">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-36 w-full" />
        </View>
      </SafeAreaView>
    );
  }

  if (booking === null) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="Booking" />
        <EmptyState icon="albums-outline" title="Booking not found" />
      </SafeAreaView>
    );
  }

  const meta = BOOKING_STEP_META[booking.status];
  const drives = ride?.driver === userId;
  const isPassenger = booking.passenger === userId;
  const rideUpcoming = ride ? RIDE_UPCOMING.includes(ride.status) : false;
  const rideLive = ride?.status === 'IN_PROGRESS';
  const canCancel = (drives || isPassenger) && ACTIVE.includes(booking.status) && rideUpcoming;
  const showRating = booking.status === 'COMPLETED' && (drives || isPassenger);
  const counterpartId = isPassenger ? ride?.driver : booking.passenger;
  const paid = booking.paid_amount != null;
  const whose = isPassenger ? 'your' : 'the passenger’s';
  const chatReadable = (drives || isPassenger) && (booking.status === 'CONFIRMED' || (paid &&
    ['COMPLETED', 'NO_SHOW', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER'].includes(booking.status)));

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title="Booking" />

      <ScrollView contentContainerClassName="px-5 pb-8" showsVerticalScrollIndicator={false}>
        <View className="mt-2">
          <Card>
            <View className="flex-row items-center justify-between gap-2">
              <Text numberOfLines={2} className="flex-1 font-semibold text-title text-fg">
                {ride ? `${ride.origin_label} → ${ride.destination_label}` : `Ride ${booking.ride.slice(0, 8)}`}
              </Text>
              <View style={{ flexShrink: 0 }}>
                <Badge label={meta?.label ?? booking.status} tone={TONE[booking.status]} size="sm" />
              </View>
            </View>
            {ride ? (
              <Text className="mt-1 text-body text-muted">
                {booking.seats} seat{booking.seats > 1 ? 's' : ''} · departs{' '}
                {format(new Date(ride.departure_at), 'EEE d MMM · HH:mm')}
              </Text>
            ) : null}
            <View className="mt-2 flex-row items-center justify-between gap-2 border-t border-line pt-3">
              <Text numberOfLines={1} className="flex-1 font-semibold text-meta text-muted">Fare</Text>
              <View style={{ flexShrink: 0 }}>
                <Fare amount={booking.fare_amount} size="md" tone="accent" />
              </View>
            </View>
          </Card>
        </View>

        {/* Tracking timeline */}
        <View className="mt-5">
          <BookingStepper status={booking.status} />
        </View>

        {error ? (
          <Text accessibilityRole="alert" className="mt-3 text-center text-meta text-deal">{error}</Text>
        ) : null}

        <View className="mt-5 gap-3">
          {chatReadable ? (
            <Button title={booking.status === 'CONFIRMED' ? 'Open chat' : 'View chat history'}
              variant="secondary" icon="chatbubble-ellipses-outline" loading={chatBusy} disabled={busy}
              onPress={() => void openChat()} block />
          ) : (drives || isPassenger) && ['REQUESTED', 'ACCEPTED'].includes(booking.status) ? (
            <Text className="text-center text-body text-muted">Chat unlocks after payment confirmation. You can message each other once the booking is confirmed.</Text>
          ) : null}

          {/* Passenger: review the server total, then pay exactly that to confirm. */}
          {isPassenger && booking.status === 'ACCEPTED' ? (
            quote ? (
              <Card>
                <Text className="font-semibold text-title text-fg">Confirm and pay</Text>
                <View className="mt-2">
                  <Line label={`Fare · ${booking.seats} seat${booking.seats > 1 ? 's' : ''}`} amount={quote.fare} />
                  {positive(quote.subsidy) ? <Line label="Sponsor discount" amount={quote.subsidy} minus /> : null}
                  {positive(quote.voucher) ? (
                    <Line label={`Voucher${quote.voucher_code ? ` ${quote.voucher_code}` : ''}`} amount={quote.voucher} minus />
                  ) : null}
                  <View className="mt-1 border-t border-line pt-1">
                    <Line label="You pay from your wallet" amount={quote.out_of_pocket} strong />
                  </View>
                  <Line label="Wallet balance" amount={quote.balance} />
                </View>
                {quote.sufficient ? (
                  <Button
                    className="mt-3"
                    title={positive(quote.out_of_pocket) ? `Pay ${formatTnd(quote.out_of_pocket)}` : 'Confirm booking'}
                    icon="shield-checkmark-outline"
                    loading={busy}
                    onPress={() => void pay()}
                    block
                  />
                ) : (
                  <View className="mt-3 gap-2">
                    <Text className="text-body text-fg">
                      Add {formatTnd((Number(quote.out_of_pocket) - Number(quote.balance)).toFixed(3))} to your wallet to confirm these seats.
                    </Text>
                    <Button title="Open wallet" variant="secondary" icon="wallet-outline" onPress={() => router.push('/wallet')} block />
                  </View>
                )}
              </Card>
            ) : (
              <Card>
                <Text className="text-body text-muted">Could not load the amount to pay.</Text>
                <Button className="mt-2" title="Try again" variant="secondary" onPress={() => void load()} block />
              </Card>
            )
          ) : null}

          {/* Driver actions follow the booking and the ride's own state. */}
          {drives && booking.status === 'REQUESTED' && rideUpcoming ? (
            <View className="flex-row gap-2">
              {ride?.status === 'OPEN' ? (
                <Button className="flex-1" title="Accept" icon="checkmark-circle-outline" loading={busy} onPress={() => void act('accept')} />
              ) : null}
              <Button className="flex-1" title="Reject" variant="danger" disabled={busy} onPress={() => void act('reject')} />
            </View>
          ) : null}
          {drives && booking.status === 'ACCEPTED' ? (
            <Text className="text-center text-body text-muted">Waiting for the passenger to pay. The seats are held until then.</Text>
          ) : null}
          {drives && booking.status === 'CONFIRMED' && rideUpcoming ? (
            <Button title="Open ride to start it" variant="secondary" icon="car-outline" onPress={() => router.push(`/ride/${booking.ride}` as never)} block />
          ) : null}
          {drives && booking.status === 'CONFIRMED' && rideLive ? (
            <View className="flex-row gap-2">
              <Button className="flex-1" title="Mark completed" icon="ribbon-outline" loading={busy} onPress={() => void act('complete')} />
              <Button className="flex-1" title="No show" variant="danger" disabled={busy} onPress={() => void act('no_show')} />
            </View>
          ) : null}

          {/* What was charged, and what came back. */}
          {paid ? (
            <Card>
              <Text className="font-semibold text-title text-fg">Payment</Text>
              <View className="mt-2">
                <Line label="Paid from wallet" amount={booking.paid_amount ?? '0.000'} />
                {positive(booking.subsidy_amount) ? <Line label="Sponsor discount" amount={booking.subsidy_amount ?? '0.000'} /> : null}
                {positive(booking.voucher_amount) ? <Line label="Voucher" amount={booking.voucher_amount ?? '0.000'} /> : null}
                {booking.refunded_amount != null ? (
                  <View className="mt-1 border-t border-line pt-1">
                    <Line label={`Returned to ${whose} wallet`} amount={booking.refunded_amount} strong />
                  </View>
                ) : null}
              </View>
            </Card>
          ) : null}

          {showRating ? (
            <Card>
              <Text className="text-center font-semibold text-title text-fg">
                {rated ? `Thanks — you rated ${rated}/5` : drives ? 'How was your passenger?' : 'How was your driver?'}
              </Text>
              {!rated ? (
                <>
                  <View className="mt-2 flex-row justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Button key={n} title={String(n)} variant="secondary" size="sm" disabled={busy} onPress={() => void rate(n)} />
                    ))}
                  </View>
                  <Field
                    label="Add a comment (optional)"
                    value={comment}
                    onChangeText={setComment}
                    placeholder="What should other members know?"
                    multiline
                    numberOfLines={3}
                    maxLength={500}
                    style={{ minHeight: 72, textAlignVertical: 'top' }}
                    editable={!busy}
                    className="mt-3"
                  />
                  <Text className="mt-1 text-meta text-faint">{comment.length}/500</Text>
                </>
              ) : (
                <Text className="mt-1 text-center text-meta text-muted">
                  {comment.trim() ? 'Your comment is visible to members who shared this ride.' : 'Your rating is saved.'}
                </Text>
              )}
            </Card>
          ) : null}

          {/* Who you travelled with: trust profile plus a validated report path. */}
          {counterpartId ? (
            <Card>
              <Text className="font-semibold text-title text-fg">{isPassenger ? 'Your driver' : 'Passenger'}</Text>
              <View className="mt-2 flex-row gap-2">
                <Button
                  className="flex-1"
                  title="View profile"
                  icon="person-circle-outline"
                  variant="secondary"
                  size="sm"
                  onPress={() => router.push(`/user/${counterpartId}` as never)}
                />
                <Button
                  className="flex-1"
                  title="Report"
                  icon="flag-outline"
                  variant="ghost"
                  size="sm"
                  onPress={() =>
                    router.push({
                      pathname: '/report',
                      params: { type: 'USER', id: counterpartId, label: `Booking ${booking.id.slice(0, 8)}` },
                    })
                  }
                />
              </View>
            </Card>
          ) : null}

          {/* Cancellation: preview what returns, then confirm. */}
          {canCancel && !cancelPreview ? (
            <Button title="Cancel booking…" variant="danger" loading={busy} onPress={() => void previewCancel()} block />
          ) : null}
          {cancelPreview ? (
            <Card>
              <Text className="font-semibold text-title text-fg">Cancel this booking?</Text>
              {cancelPreview.allowed ? (
                <View className="mt-2 gap-1">
                  {positive(cancelPreview.refund) ? (
                    <Text className="text-body text-fg">{formatTnd(cancelPreview.refund)} goes back to {whose} wallet.</Text>
                  ) : (
                    <Text className="text-body text-fg">Nothing was charged, so there is nothing to refund.</Text>
                  )}
                  {positive(cancelPreview.subsidy_returned) ? (
                    <Text className="text-body text-muted">The {formatTnd(cancelPreview.subsidy_returned)} sponsor discount returns to the sponsor.</Text>
                  ) : null}
                  {positive(cancelPreview.voucher_returned) ? (
                    <Text className="text-body text-muted">The {formatTnd(cancelPreview.voucher_returned)} voucher can be used again.</Text>
                  ) : null}
                  {cancelPreview.seats_released > 0 ? (
                    <Text className="text-body text-muted">
                      {cancelPreview.seats_released > 1 ? `${cancelPreview.seats_released} seats reopen` : '1 seat reopens'} on the ride.
                    </Text>
                  ) : null}
                </View>
              ) : (
                <Text className="mt-2 text-body text-muted">This booking can no longer be cancelled.</Text>
              )}
              <View className="mt-3 flex-row gap-2">
                <Button className="flex-1" title="Keep booking" variant="secondary" disabled={busy} onPress={() => setCancelPreview(null)} />
                {cancelPreview.allowed ? (
                  <Button
                    className="flex-1"
                    title="Cancel booking"
                    variant="danger"
                    loading={busy}
                    onPress={() => void act(cancelPreview.action as BookingAction)}
                  />
                ) : null}
              </View>
            </Card>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
