import { cssInterop } from 'nativewind';
import { Platform, Pressable, type PressableProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// On web (react-native-web), NativeWind's automatic className→style transform
// doesn't reach this animated Pressable wrapper, so register the interop
// explicitly there. On native the Babel transform already applies className.
if (Platform.OS === 'web') {
  cssInterop(AnimatedPressable, { className: 'style' });
}

export interface PressableScaleProps extends PressableProps {
  /** Scale applied while pressed. Default 0.97. */
  scaleTo?: number;
  className?: string;
}

/**
 * Pressable with a spring scale on press — the global press micro-interaction.
 * Falls back to no transform when reduce-motion is on.
 */
export function PressableScale({
  scaleTo = 0.97,
  onPressIn,
  onPressOut,
  style,
  className,
  disabled,
  accessibilityState,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduced ? 1 : scale.value }],
  }));

  return (
    <AnimatedPressable
      disabled={disabled}
      // react-native-web 0.21 ignores accessibilityState; aria-* works on web and native.
      accessibilityState={accessibilityState}
      aria-checked={accessibilityState?.checked}
      aria-selected={accessibilityState?.selected}
      aria-expanded={accessibilityState?.expanded}
      aria-busy={accessibilityState?.busy}
      aria-disabled={accessibilityState?.disabled ?? (disabled ? true : undefined)}
      className={className}
      onPressIn={(e) => {
        // Reanimated shared values are mutable by design; the compiler lint
        // doesn't model them.
        // eslint-disable-next-line react-hooks/immutability
        scale.value = withSpring(scaleTo, { damping: 18, stiffness: 320 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        // eslint-disable-next-line react-hooks/immutability
        scale.value = withSpring(1, { damping: 18, stiffness: 320 });
        onPressOut?.(e);
      }}
      style={[animatedStyle, style]}
      {...rest}
    />
  );
}
