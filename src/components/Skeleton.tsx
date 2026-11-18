import { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { cn } from '@/lib/cn';
import { CARD_SHADOW } from '@/lib/theme';

/**
 * A single pulsing placeholder block. Layout comes from `className`; only the
 * opacity animates, so it stays cheap on low-end Android and on web.
 */
export function Skeleton({ className, style }: { className?: string; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(reduced ? 1 : 0.45);

  useEffect(() => {
    if (reduced) {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 850 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse, reduced]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={[animated, style]}>
      <View className={cn('rounded-md bg-fg/10', className)} />
    </Animated.View>
  );
}

/** Paragraph placeholder with a short last line. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <View className={cn('gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn('h-3', index === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </View>
  );
}

/** Generic card: avatar, two lines and a trailing pill. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <View
      style={CARD_SHADOW}
      className={cn('flex-row items-center gap-3 rounded-card bg-surface p-4', className)}>
      <Skeleton className="h-11 w-11 rounded-pill" />
      <View className="flex-1 gap-2">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-3/4" />
      </View>
      <Skeleton className="h-8 w-16 rounded-pill" />
    </View>
  );
}

/** Matches the RideCard rhythm so the swap into real data doesn't jump. */
export function SkeletonRideCard({ className }: { className?: string }) {
  return (
    <View
      style={CARD_SHADOW}
      className={cn('gap-3 rounded-card bg-surface p-4', className)}>
      <View className="flex-row items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-pill" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
        </View>
        <Skeleton className="h-6 w-14 rounded-pill" />
      </View>
      <View className="gap-2">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </View>
      <View className="flex-row items-center justify-between border-t border-line pt-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-16" />
      </View>
    </View>
  );
}

/** Full-screen placeholder for the session/fonts bootstrap in the root layout. */
export function AppBootSkeleton() {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-bg px-8">
      <Skeleton className="h-20 w-20 rounded-panel" />
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-3 w-40" />
      <View className="mt-6 w-full gap-3">
        <Skeleton className="h-14 w-full rounded-card" />
        <Skeleton className="h-14 w-full rounded-card" />
        <Skeleton className="h-14 w-full rounded-card" />
      </View>
    </View>
  );
}
