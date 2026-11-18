import { Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';

export interface Place {
  lat: number;
  lng: number;
  label: string;
}

interface PointPickerProps {
  title: string;
  point: Place | null;
  onPick: (p: Place) => void;
}

/** Native coordinate picker: tap the map to set the point. */
export function PointPicker({ title, point, onPick }: PointPickerProps) {
  return (
    <View className="gap-2">
      <Text className="font-semibold text-meta text-muted">{title}</Text>
      <View className="overflow-hidden rounded-card border border-line">
        <MapView
          style={{ height: 180, width: '100%' }}
          provider={PROVIDER_DEFAULT}
          initialRegion={{
            latitude: point?.lat ?? 36.8065,
            longitude: point?.lng ?? 10.1815,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          }}
          onPress={(e) =>
            onPick({
              lat: e.nativeEvent.coordinate.latitude,
              lng: e.nativeEvent.coordinate.longitude,
              label: `${e.nativeEvent.coordinate.latitude.toFixed(4)}, ${e.nativeEvent.coordinate.longitude.toFixed(4)}`,
            })
          }>
          {point ? <Marker coordinate={{ latitude: point.lat, longitude: point.lng }} /> : null}
        </MapView>
      </View>
      <Text className="text-meta text-faint">{point ? point.label : 'Tap the map to set the point'}</Text>
    </View>
  );
}
