import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Place } from './point-picker';

interface PointPickerProps {
  title: string;
  point: Place | null;
  onPick: (p: Place) => void;
}

/**
 * Web fallback: react-native-maps has no web implementation, so the route
 * bundle must never import it on web. Tapping cycles deterministic points
 * around Tunis so the publish flow stays testable in a browser.
 */
export function PointPicker({ title, point, onPick }: PointPickerProps) {
  const [seed, setSeed] = useState(0);

  const pick = () => {
    const next = seed + 1;
    setSeed(next);
    const lat = 36.8065 + ((next % 10) - 5) * 0.01;
    const lng = 10.1815 + ((next % 7) - 3) * 0.01;
    onPick({ lat, lng, label: `${lat.toFixed(4)}, ${lng.toFixed(4)} (web)` });
  };

  return (
    <View className="gap-2">
      <Text className="font-semibold text-meta text-muted">{title}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Set ${title.toLowerCase()} on map`}
        onPress={pick}
        className="h-[180px] items-center justify-center rounded-card border border-line bg-surface active:opacity-70">
        <Text className="text-body text-faint">{point ? point.label : 'Map preview unavailable on web — tap to set point'}</Text>
      </Pressable>
    </View>
  );
}
