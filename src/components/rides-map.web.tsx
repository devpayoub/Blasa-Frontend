import { format } from 'date-fns';
import { Text, View } from 'react-native';

import { latLng } from '@/lib/geo';
import { CARD_SHADOW } from '@/lib/theme';
import { PressableScale } from './PressableScale';
import type { RidesMapProps } from './rides-map';

const HEIGHT = 300;
const PAD = 0.12;
const PIN = 30;

/**
 * Web fallback: react-native-maps has no web build, so pickups are plotted by
 * relative position (north up) on a plain canvas. Same data and tap target as native.
 */
export function RidesMap({ rides, onSelect }: RidesMapProps) {
  const pins = rides.flatMap((ride) => {
    const point = latLng(ride.origin);
    return point ? [{ ride, point }] : [];
  });
  if (pins.length === 0) {
    return <Text className="py-10 text-center text-body text-muted">These rides have no pickup coordinates to map.</Text>;
  }
  const lats = pins.map((p) => p.point.lat);
  const lngs = pins.map((p) => p.point.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const span = (lo: number, hi: number, v: number) => (hi - lo < 1e-6 ? 0.5 : (v - lo) / (hi - lo));
  const placed: { x: number; top: number }[] = [];

  return (
    <View className="gap-2">
      <View
        accessibilityLabel={`Map of ${pins.length} pickup points`}
        className="overflow-hidden rounded-card border border-line bg-accentSoft/40"
        style={{ height: HEIGHT }}>
        {pins.map(({ ride, point }) => {
          const x = PAD + span(minLng, maxLng, point.lng) * (1 - 2 * PAD);
          const baseTop = (PAD + (1 - span(minLat, maxLat, point.lat)) * (1 - 2 * PAD)) * HEIGHT - PIN / 2;
          // Overlapping pins fan out, one pin height at a time, away from the nearest edge.
          const step = baseTop > HEIGHT / 2 ? -PIN : PIN;
          let top = baseTop;
          while (placed.some((p) => Math.abs(p.x - x) < 0.2 && Math.abs(p.top - top) < PIN)) top += step;
          placed.push({ x, top });
          const left = `${x * 100}%` as const;
          const when = format(new Date(ride.departure_at), 'EEE HH:mm');
          return (
            <PressableScale
              key={ride.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ride from ${ride.origin_label} to ${ride.destination_label}, ${when}, ${ride.price_per_seat} TND`}
              onPress={() => onSelect(ride)}
              style={[CARD_SHADOW, { position: 'absolute', left, top, marginLeft: -40 }]}
              className="flex-row items-center gap-1 rounded-pill bg-surface px-2.5 py-1">
              <View className="h-2 w-2 rounded-full bg-accent" />
              <Text className="font-semibold text-meta text-fg">{when}</Text>
            </PressableScale>
          );
        })}
      </View>
      <Text className="text-meta text-faint">Pickup points by relative position, north up. The mobile app shows a street map.</Text>
    </View>
  );
}
