import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColors } from '@/lib/theme';

/**
 * A lightweight themed activity spinner — a rotating arc built from a bordered
 * circle, so it follows the accent color in both light and dark.
 */
export function Spinner({ size = 24, className }: { size?: number; className?: string }) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    rotation.value = withRepeat(withTiming(360, { duration: 800, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(rotation);
  }, [reduced, rotation]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  const border = Math.max(2, Math.round(size / 9));

  return (
    <View className={className}>
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: border,
            borderColor: colors.line,
            borderTopColor: colors.accent,
            borderRightColor: colors.accent,
          },
          style,
        ]}
      />
    </View>
  );
}
