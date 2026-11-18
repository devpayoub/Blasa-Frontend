import { format } from 'date-fns';
import { Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

import { latLng } from '@/lib/geo';
import type { Ride } from '@/types';

export interface RidesMapProps {
  rides: Ride[];
  onSelect: (ride: Ride) => void;
}

/** Pickup points of the current results; tapping a pin's callout opens the ride. */
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
  const region = {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max(0.1, (Math.max(...lats) - Math.min(...lats)) * 1.6),
    longitudeDelta: Math.max(0.1, (Math.max(...lngs) - Math.min(...lngs)) * 1.6),
  };

  return (
    <View className="overflow-hidden rounded-card border border-line">
      <MapView style={{ height: 360, width: '100%' }} provider={PROVIDER_DEFAULT} initialRegion={region}>
        {pins.map(({ ride, point }) => (
          <Marker
            key={ride.id}
            coordinate={{ latitude: point.lat, longitude: point.lng }}
            title={`${ride.origin_label} → ${ride.destination_label}`}
            description={`${format(new Date(ride.departure_at), 'EEE d MMM · HH:mm')} · ${ride.price_per_seat} TND`}
            onCalloutPress={() => onSelect(ride)}
          />
        ))}
      </MapView>
    </View>
  );
}
