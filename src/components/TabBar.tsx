import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from './Icon';

interface TabConfig {
  label: string;
  active: IconName;
  inactive: IconName;
}

const TABS: Record<string, TabConfig> = {
  index: { label: 'Home', active: 'home', inactive: 'home-outline' },
  rides: { label: 'Rides', active: 'search', inactive: 'search-outline' },
  bookings: { label: 'Bookings', active: 'albums', inactive: 'albums-outline' },
  chats: { label: 'Chats', active: 'chatbubble-ellipses', inactive: 'chatbubble-ellipses-outline' },
  account: { label: 'Account', active: 'person', inactive: 'person-outline' },
};

const PILL_SPRING = { damping: 20, stiffness: 160, mass: 0.8 };

// Raw RGB strings for Reanimated color interpolation (needs actual values, not className)
const NAVY_RGB = '19, 41, 75';
const ACCENT_RGB = '255, 106, 31';

// Pill dimensions
const PILL_WIDTH = 56;

/**
 * The real props expo-router's `<Tabs tabBar={...}>` callback passes.
 * This mirrors `BottomTabBarProps` from expo-router's bottom-tabs types.
 */
export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string; params?: object }[] };
  descriptors: Record<string, { options: { title?: string } }>;
  emitter: {
    emit: (e: {
      type: 'tabPress';
      target?: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean; preventDefault: () => void };
  };
  navigateToTab: (routeKey: string) => void;
  insets: { top: number; bottom: number; left: number; right: number };
}

export function TabBar({ state, emitter, navigateToTab, insets }: TabBarProps) {
  const safeInsets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  const routes = state.routes.filter((r) => TABS[r.name]);
  const activeIndex = routes.findIndex((r) => r.key === state.routes[state.index]?.key);

  // Shared value for the sliding pill indicator (0-based index)
  const pillIndex = useSharedValue(activeIndex >= 0 ? activeIndex : 0);

  useEffect(() => {
    if (reduced) {
      pillIndex.value = activeIndex >= 0 ? activeIndex : 0;
    } else {
      pillIndex.value = withSpring(activeIndex >= 0 ? activeIndex : 0, PILL_SPRING);
    }
  }, [activeIndex, reduced, pillIndex]);

  const tabCount = routes.length;
  const bottomInset = insets?.bottom ?? safeInsets.bottom;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: bottomInset > 0 ? bottomInset + 6 : 14,
        paddingHorizontal: 14,
        paddingTop: 6,
      }}>
      {/*
        The bar container. The pill indicator lives inside the same row as
        the tab items so its percentage-based left maps to the same content
        area the tabs occupy — no padding offset mismatch.
      */}
      <View
        style={{
          backgroundColor: `rgb(${NAVY_RGB})`,
          borderRadius: 28,
          paddingVertical: 8,
          paddingHorizontal: 6,
          shadowColor: `rgb(${NAVY_RGB})`,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.22,
          shadowRadius: 24,
          elevation: 12,
        }}>
        {/*
          Inner row — this is the content area the pill is relative to.
          Each tab has flex:1, so the pill's left percentage aligns exactly
          with tab centers.
        */}
        <View style={{ flexDirection: 'row', position: 'relative' }}>
          {/* Sliding pill indicator */}
          <SlidingPill pillIndex={pillIndex} tabCount={tabCount} />

          {/* Tab items */}
          {routes.map((route, i) => {
            const cfg = TABS[route.name];
            const focused = i === activeIndex;
            const onPress = () => {
              const event = emitter.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigateToTab(route.key);
              }
            };
            return (
              <TabItem
                key={route.key}
                config={cfg}
                focused={focused}
                pillIndex={pillIndex}
                myIndex={i}
                onPress={onPress}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

/* ─────────────────────────  Sliding Pill  ───────────────────────── */

function SlidingPill({
  pillIndex,
  tabCount,
}: {
  pillIndex: SharedValue<number>;
  tabCount: number;
}) {
  const pillStyle = useAnimatedStyle(() => {
    // Each tab occupies 1/tabCount of the row width.
    // Center of tab N = (N + 0.5) / tabCount * 100%
    const tabFraction = 1 / tabCount;
    const centerPercent = (pillIndex.value * tabFraction + tabFraction / 2) * 100;
    return {
      left: `${centerPercent}%`,
      // Shift left by half the pill width to truly center it on the tab
      transform: [{ translateX: -PILL_WIDTH / 2 }],
      width: PILL_WIDTH,
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: 0,
          bottom: 0,
          borderRadius: 22,
          backgroundColor: `rgba(${ACCENT_RGB}, 0.14)`,
        },
        pillStyle,
      ]}
    />
  );
}

/* ─────────────────────────  Tab Item  ───────────────────────── */

function TabItem({
  config,
  focused,
  pillIndex,
  myIndex,
  onPress,
}: {
  config: TabConfig;
  focused: boolean;
  pillIndex: SharedValue<number>;
  myIndex: number;
  onPress: () => void;
}) {
  const press = useSharedValue(0);

  // Active icon lifts and scales; pressing nudges it down
  const iconContainerStyle = useAnimatedStyle(() => {
    const dist = Math.abs(pillIndex.value - myIndex);
    const localProgress = Math.max(0, 1 - dist);
    return {
      transform: [
        { translateY: -localProgress * 5 - press.value * 1.5 },
        { scale: 1 + localProgress * 0.12 - press.value * 0.1 },
      ],
    };
  });

  // Cross-fade between inactive and active icon layers.
  const inactiveIconStyle = useAnimatedStyle(() => {
    const dist = Math.abs(pillIndex.value - myIndex);
    const localProgress = Math.max(0, 1 - dist);
    return { opacity: 1 - localProgress };
  });

  const activeIconStyle = useAnimatedStyle(() => {
    const dist = Math.abs(pillIndex.value - myIndex);
    const localProgress = Math.max(0, 1 - dist);
    return { opacity: localProgress };
  });

  // Label: opacity + translateY + color
  const labelStyle = useAnimatedStyle(() => {
    const dist = Math.abs(pillIndex.value - myIndex);
    const localProgress = Math.max(0, 1 - dist);
    const r = Math.round(240 + (255 - 240) * localProgress);
    const g = Math.round(231 + (106 - 231) * localProgress);
    const b = Math.round(213 + (31 - 213) * localProgress);
    const a = 0.55 + (1 - 0.55) * localProgress;
    return {
      opacity: 0.5 + localProgress * 0.5,
      transform: [{ translateY: -localProgress * 1 }],
      color: `rgba(${r}, ${g}, ${b}, ${a})`,
    };
  });

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={config.label}
      onPress={onPress}
      onPressIn={() => {
        press.value = withTiming(1, { duration: 90 });
      }}
      onPressOut={() => {
        press.value = withTiming(0, { duration: 160 });
      }}
      style={{ flex: 1 }}
      className="items-center justify-center gap-[3px] py-1.5">
      <View style={{ height: 28, width: 48, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={iconContainerStyle}>
          {/* Two icons stacked — cross-fade opacity for smooth color transition */}
          <View style={{ position: 'relative', width: 23, height: 23 }}>
            <Animated.View style={[{ position: 'absolute' }, inactiveIconStyle]}>
              <Icon name={config.inactive} size={23} className="text-cream/55" />
            </Animated.View>
            <Animated.View style={[{ position: 'absolute' }, activeIconStyle]}>
              <Icon name={config.active} size={23} className="text-accent" />
            </Animated.View>
          </View>
        </Animated.View>
      </View>
      <Animated.Text
        style={[
          labelStyle,
          { fontSize: 11, fontWeight: focused ? ('700' as const) : ('500' as const) },
        ]}>
        {config.label}
      </Animated.Text>
    </Pressable>
  );
}
