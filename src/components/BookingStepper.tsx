import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { cn } from '@/lib/cn';
import { BOOKING_FLOW, BOOKING_STEP_META, type BookingStatus } from '@/types';
import { Icon } from './Icon';

interface StepMeta {
  status: Extract<BookingStatus, 'ACCEPTED' | 'CONFIRMED' | 'COMPLETED'>;
  icon: 'checkmark-circle-outline' | 'shield-checkmark-outline' | 'ribbon-outline';
}

const STEPS: StepMeta[] = [
  { status: 'ACCEPTED', icon: 'checkmark-circle-outline' },
  { status: 'CONFIRMED', icon: 'shield-checkmark-outline' },
  { status: 'COMPLETED', icon: 'ribbon-outline' },
];

export interface BookingStepperProps {
  status: BookingStatus;
  className?: string;
}

/**
 * Vertical booking-status timeline. Shows where the booking stands inside the
 * ACCEPTED → CONFIRMED → COMPLETED flow; terminal/cancel states render as an
 * info banner instead of the stepper.
 */
export function BookingStepper({ status, className }: BookingStepperProps) {
  const reduced = useReducedMotion();

  // Cancelled/rejected/no-show: not part of the forward flow.
  const terminal: BookingStatus[] = ['REJECTED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'NO_SHOW'];
  if (terminal.includes(status)) {
    const meta = BOOKING_STEP_META[status];
    return (
      <View className={cn('flex-row items-center gap-2 rounded-card bg-surface px-4 py-3', className)}>
        <Icon name="information-circle-outline" size={20} className="text-warning" />
        <Text className="flex-1 text-body text-fg">
          {meta.label} — {meta.hint}
        </Text>
      </View>
    );
  }

  // REQUESTED isn't in the flow array either — it's step 0, all pending.
  const currentIndex = status === 'REQUESTED' ? -1 : BOOKING_FLOW.indexOf(status as 'ACCEPTED');

  return (
    <View className={cn('gap-0', className)}>
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const meta = BOOKING_STEP_META[step.status];
        const last = i === STEPS.length - 1;

        return (
          <Animated.View
            key={step.status}
            entering={reduced ? undefined : FadeInDown.delay(i * 80).duration(260)}>
            <View className="flex-row gap-3">
              <View className="items-center">
                <View className="relative h-9 w-9 items-center justify-center">
                  {active ? <PulseRing reduced={reduced} /> : null}
                  <View className={cn('h-9 w-9 items-center justify-center rounded-pill', done || active ? 'bg-accent' : 'bg-line')}>
                    <Icon name={done ? 'checkmark' : step.icon} size={18} className={done || active ? 'text-onAccent' : 'text-muted'} />
                  </View>
                </View>
                {!last ? <View className={cn('w-0.5 flex-1', done ? 'bg-accent' : 'bg-line')} /> : null}
              </View>

              <View className={cn('flex-1 pb-6', last && 'pb-0')}>
                <Text className={cn('text-title font-semibold', done || active ? 'text-fg' : 'text-faint')}>{meta.label}</Text>
                {active ? (
                  <Animated.Text entering={reduced ? undefined : FadeIn.duration(220)} className="mt-0.5 text-body text-muted">
                    {meta.hint}
                  </Animated.Text>
                ) : (
                  <Text className="mt-0.5 text-body text-faint">{meta.hint}</Text>
                )}
              </View>
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** Expanding accent ring behind the active step. */
function PulseRing({ reduced }: { reduced: boolean }) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    p.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.ease) }), -1, false);
    return () => cancelAnimation(p);
  }, [reduced, p]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.9 + p.value * 0.9 }],
    opacity: 0.4 * (1 - p.value),
  }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 36, height: 36, borderRadius: 18 }, style]} className="bg-accent" />;
}
