import { format, isAfter } from 'date-fns';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, Icon, PressableScale, RideCard, SectionHeader, SkeletonRideCard, type IconName } from '@/components';
import { CARD_SHADOW } from '@/lib/theme';
import { listRides, ridesNear } from '@/services/rides';
import { useSession } from '@/store/session';
import type { Ride } from '@/types';

const QUICK_ACTIONS: { label: string; icon: IconName; href: string }[] = [
  { label: 'Find a ride', icon: 'search-outline', href: '/(tabs)/rides' },
  { label: 'Route alerts', icon: 'notifications-outline', href: '/interests' },
  // Passengers and brands land on Account, where the upgrade lives — sending
  // them to /ride/publish only bounces off the driver-mode guard.
  { label: 'Become a driver', icon: 'car-sport-outline', href: '/(tabs)/account' },
];

const STATS = [
  { label: 'Cities', value: '12', icon: 'map-outline' as IconName },
  { label: 'Rides today', value: '48+', icon: 'car-sport-outline' as IconName },
  { label: 'Avg fare', value: '15 TND', icon: 'cash-outline' as IconName },
];

export default function HomeScreen() {
  const user = useSession((s) => s.user);
  const isDriver = user?.role === 'DRIVER';
  const isBrand = user?.role === 'BRAND';
  const [rides, setRides] = useState<Ride[] | undefined>(undefined);
  const loading = rides === undefined;

  const load = useCallback(() => {
    ridesNear(36.8065, 10.1815, 25)
      .then((page) => page.results)
      .catch(() => listRides().then((p) => p.results))
      .then((source) => {
        const upcoming = source
          .filter((r) => r.status === 'OPEN' && isAfter(new Date(r.departure_at), new Date()))
          .slice(0, 5);
        setRides(upcoming);
      })
      .catch(() => setRides([]));
  }, []);

  useFocusEffect(load);

  const firstName = user?.profile?.full_name?.split(' ')[0];

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView contentContainerClassName="pb-24" showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View className="flex-row items-center justify-between px-5 pt-3">
          <View className="flex-row items-center gap-2.5">
            <View className="h-10 w-10 items-center justify-center rounded-pill bg-navy">
              <Icon name="car-sport" size={20} className="text-accent" />
            </View>
            <Text className="text-display font-bold text-fg">Blasa</Text>
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Account"
            onPress={() => router.push('/(tabs)/account')}
            className="h-10 w-10 items-center justify-center rounded-pill bg-fg/8">
            {user?.profile?.full_name ? (
              <Text className="text-title font-bold text-fg">
                {user.profile.full_name.charAt(0).toUpperCase()}
              </Text>
            ) : (
              <Icon name="person-outline" size={20} className="text-fg" />
            )}
          </PressableScale>
        </View>

        {/* ── Hero banner — the navy 30% doing its job, one orange CTA ── */}
        <View
          style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
          className="mx-5 mt-4 overflow-hidden rounded-panel bg-navy">
          <View className="p-5">
            <Text className="text-meta font-semibold text-cream/60">
              {format(new Date(), 'EEEE, d MMM')}
            </Text>
            <Text className="mt-1 text-display font-bold text-cream">
              {firstName ? `Ahla, ${firstName}` : 'Where to today?'}
            </Text>
            <Text className="mt-1 text-body text-cream/75">
              {isDriver
                ? 'Publish a ride and start earning.'
                : isBrand
                  ? 'See live rides across Tunisia.'
                  : 'Find a driver going your way across Tunisia.'}
            </Text>
            <View className="mt-4">
              {isDriver ? (
                <PressableScale
                  onPress={() => router.push('/ride/publish')}
                  className="self-start flex-row items-center gap-2 rounded-pill bg-accent px-4 py-2">
                  <Icon name="add-circle-outline" size={18} className="text-onAccent" />
                  <Text className="font-bold text-body text-onAccent">Offer a ride</Text>
                </PressableScale>
              ) : (
                <PressableScale
                  onPress={() => router.push('/(tabs)/rides')}
                  className="self-start flex-row items-center gap-2 rounded-pill bg-accent px-4 py-2">
                  <Icon name="search-outline" size={18} className="text-onAccent" />
                  <Text className="font-bold text-body text-onAccent">Browse rides</Text>
                </PressableScale>
              )}
            </View>
          </View>
        </View>

        {/* ── Stats strip — one tonal row, not three bordered widgets ── */}
        <View
          style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
          className="mx-5 mt-3 flex-row rounded-card bg-surface px-2 py-3">
          {STATS.map((s, i) => (
            <View key={s.label} className="flex-1 flex-row items-center justify-center gap-2">
              {i > 0 ? <View className="absolute left-0 h-8 w-px bg-line" /> : null}
              <Icon name={s.icon} size={16} className="text-accentStrong" />
              <View>
                <Text className="font-bold tabular-nums text-title text-fg">{s.value}</Text>
                <Text className="text-meta text-muted">{s.label}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Quick actions (passenger only) ── */}
        {!isDriver ? (
          <View className="mt-4 px-5">
            <Text className="mb-2 font-bold text-h text-fg">Quick actions</Text>
            <View className="flex-row flex-wrap gap-2">
              {QUICK_ACTIONS.map((action) => (
                <PressableScale
                  key={action.label}
                  accessibilityRole="button"
                  onPress={() => router.push(action.href as never)}
                  className="flex-row items-center gap-2 rounded-pill bg-surface px-4 py-2.5">
                  <Icon name={action.icon} size={16} className="text-accentStrong" />
                  <Text className="font-semibold text-body text-fg">{action.label}</Text>
                </PressableScale>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Upcoming rides ── */}
        <SectionHeader
          title="Upcoming rides"
          subtitle="Open rides around you"
          onSeeAll={() => router.push('/(tabs)/rides')}
        />

        {loading ? (
          <View className="gap-3 px-5">
            {[0, 1, 2].map((key) => (
              <SkeletonRideCard key={key} />
            ))}
          </View>
        ) : rides.length === 0 ? (
          <EmptyState
            icon="map-outline"
            title="No rides yet"
            message="No open rides around Tunis right now. Try the full list or come back later."
            actionLabel="Browse all rides"
            onAction={() => router.push('/(tabs)/rides')}
          />
        ) : (
          <View className="gap-3 px-5">
            {rides.map((ride) => (
              <RideCard
                key={ride.id}
                ride={ride}
                onPress={() => router.push(`/ride/${ride.id}` as never)}
              />
            ))}
          </View>
        )}

        {/* ── Rating card ── */}
        {user?.profile ? (
          <View
            style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
            className="mx-5 mt-6 rounded-card bg-surface p-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <View className="h-9 w-9 items-center justify-center rounded-pill bg-accentSoft">
                  <Icon name="star" size={16} className="text-accentStrong" />
                </View>
                <Text className="font-semibold text-title text-fg">Your rating</Text>
              </View>
              <Text className="font-bold tabular-nums text-h text-fg">
                {user.profile.average_rating ?? '—'}
              </Text>
            </View>
            <Text className="mt-2 text-meta text-muted">
              {user.role.toLowerCase()} · {user.is_verified ? 'verified' : 'not verified yet'} ·{' '}
              {format(new Date(), 'd MMM yyyy')}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
