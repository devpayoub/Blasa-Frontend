import { format } from 'date-fns';
import { Text, View } from 'react-native';

import { cn } from '@/lib/cn';
import { CARD_SHADOW } from '@/lib/theme';
import { BOOKING_STEP_META, type Ride } from '@/types';
import { Fare } from './Fare';
import { Icon } from './Icon';
import { Badge } from './Badge';
import { PersonSummary } from './PersonSummary';
import { PressableScale } from './PressableScale';

const STATUS_TONE: Record<string, 'accent' | 'warning' | 'deal' | 'neutral'> = {
  OPEN: 'accent',
  FULL: 'warning',
  IN_PROGRESS: 'warning',
  COMPLETED: 'neutral',
  CANCELLED: 'deal',
};

/** Seat copy that makes sense for the ride's state, not just the counts. */
export function rideSeatsLabel(ride: Ride): string {
  if (ride.status === 'FULL') return 'Fully booked';
  if (ride.status === 'IN_PROGRESS') return 'Trip in progress';
  if (ride.status === 'COMPLETED') return 'Trip completed';
  if (ride.status === 'CANCELLED') return 'Ride cancelled';
  const left = `${ride.seats_available} of ${ride.seats_total}`;
  return ride.seats_total === 1 ? `${left} seat left` : `${left} seats left`;
}

export interface RideCardProps {
  ride: Ride;
  onPress?: () => void;
  /** Hide the driver line where the viewer is the driver. */
  showDriver?: boolean;
  className?: string;
}

/** Ride summary card: route, departure, driver trust, seats left, price per seat. */
export function RideCard({ ride, onPress, showDriver = true, className }: RideCardProps) {
  const when = ride.departure_at ? format(new Date(ride.departure_at), 'EEE d MMM · HH:mm') : '—';
  const tone = STATUS_TONE[ride.status] ?? 'neutral';

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Ride from ${ride.origin_label} to ${ride.destination_label}`}
      onPress={onPress}
      style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
      className={cn('rounded-card bg-surface p-4', className)}>
      <View className="flex-row items-center justify-between">
        <Text className="font-semibold text-meta text-muted">{when}</Text>
        <Badge label={ride.status.replace('_', ' ')} tone={tone} size="sm" />
      </View>

      <View className="mt-2 flex-row items-center gap-2">
        <View className="items-center py-1">
          <View className="h-2.5 w-2.5 rounded-full border-2 border-fg bg-surface" />
          <View className="my-0.5 w-0.5 flex-1 bg-line" />
          <View className="h-2.5 w-2.5 rounded-full bg-accent" />
        </View>
        <View className="flex-1 gap-1.5 py-0.5">
          <Text numberOfLines={1} className="font-semibold text-title text-fg">
            {ride.origin_label}
          </Text>
          <Text numberOfLines={1} className="font-semibold text-title text-fg">
            {ride.destination_label}
          </Text>
        </View>
        <Fare amount={ride.price_per_seat} size="md" tone="accent" className="self-start" />
      </View>

      {showDriver && ride.driver_summary ? <PersonSummary summary={ride.driver_summary} className="mt-2.5" /> : null}

      {ride.sponsorship?.active ? (
        <View className="mt-2 flex-row items-center gap-1.5">
          <Badge label="Sponsored" tone="soft" size="sm" />
          <Text numberOfLines={1} className="flex-1 text-meta text-accentStrong">
            {`${ride.sponsorship.brand_name} · ${ride.sponsorship.discount_per_seat} TND off per seat`}
          </Text>
        </View>
      ) : null}

      <View className="mt-3 flex-row items-center justify-between border-t border-line pt-2.5">
        <View className="flex-row items-center gap-1.5">
          <Icon name="people-outline" size={16} className="text-muted" />
          <Text className="text-meta text-muted">{rideSeatsLabel(ride)}</Text>
        </View>
        {ride.distance_km != null ? (
          <Text className="text-meta text-faint">
            {ride.distance_km < 0.1 ? 'Pickup under 100 m away' : `Pickup ${ride.distance_km} km away`}
          </Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** Booking status pill text helper reused by booking rows. */
export function bookingStatusLabel(status: keyof typeof BOOKING_STEP_META): string {
  return BOOKING_STEP_META[status]?.label ?? status;
}
