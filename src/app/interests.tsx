import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, EmptyState, Field, Icon, PressableScale, ScreenHeader, Spinner, rideSeatsLabel } from '@/components';
import { format, isSameDay } from 'date-fns';
import { CITIES, type City } from '@/lib/places';
import { CARD_SHADOW } from '@/lib/theme';
import { createInterest, deleteInterest, listInterests, matchingRidesForInterest } from '@/services/interests';
import type { Interest, Ride } from '@/types';

/** Route alerts: saved routes; each can pull its ranked matching rides. */
export default function InterestsScreen() {
  const [interests, setInterests] = useState<Interest[] | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Ride[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ from: City | null; to: City | null; earliest: string; latest: string; seats: string }>({
    from: null,
    to: null,
    earliest: '',
    latest: '',
    seats: '1',
  });
  const [error, setError] = useState('');
  const loading = interests === undefined;

  const load = useCallback(() => {
    return listInterests()
      .then((page) => setInterests(page.results))
      .catch(() => setInterests([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (interest: Interest) => {
    if (expandedId === interest.id) {
      setExpandedId(null);
      setMatches([]);
      return;
    }
    setExpandedId(interest.id);
    setMatches([]);
    try {
      setMatches(await matchingRidesForInterest(interest.id));
    } catch {
      setMatches([]);
    }
  };

  const create = async () => {
    setError('');
    const earliest = new Date(form.earliest);
    const latest = new Date(form.latest);
    if (!form.from || !form.to || form.from.name === form.to.name) {
      setError('Pick two different cities');
      return;
    }
    if (Number.isNaN(earliest.getTime()) || Number.isNaN(latest.getTime())) {
      setError('Dates must be YYYY-MM-DD HH:MM');
      return;
    }
    if (latest < earliest) {
      setError('Latest must be after earliest');
      return;
    }
    setCreating(true);
    try {
      await createInterest({
        origin: { lat: form.from.lat, lng: form.from.lng },
        origin_label: form.from.name,
        destination: { lat: form.to.lat, lng: form.to.lng },
        destination_label: form.to.name,
        earliest_departure: earliest.toISOString(),
        latest_departure: latest.toISOString(),
        seats: Number(form.seats) || 1,
      });
      setForm({ from: null, to: null, earliest: '', latest: '', seats: '1' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the route alert');
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title="Route alerts" />

      {loading ? (
        <Spinner className="mt-10 self-center" />
      ) : (
        <FlatList
          data={interests}
          keyExtractor={(i) => i.id}
          ListEmptyComponent={
            <EmptyState icon="notifications-outline" title="No route alerts yet" message="Save a route you travel often and we'll alert you when a matching ride is published." />
          }
          contentContainerClassName="gap-3 px-5 pb-6 pt-2"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View
              style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
              className="rounded-card bg-surface p-4">
              <PressableScale onPress={() => void toggle(item)} className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="font-semibold text-title text-fg">
                    {item.origin_label} → {item.destination_label}
                  </Text>
                  <Text className="mt-0.5 text-meta text-muted">
                    {format(new Date(item.earliest_departure), 'd MMM HH:mm')} –{' '}
                    {format(new Date(item.latest_departure), isSameDay(new Date(item.earliest_departure), new Date(item.latest_departure)) ? 'HH:mm' : 'd MMM HH:mm')} · {item.seats}{' '}
                    seat{item.seats === 1 ? '' : 's'}
                  </Text>
                </View>
                <Icon name={expandedId === item.id ? 'chevron-up' : 'chevron-down'} size={20} className="text-muted" />
              </PressableScale>

              {expandedId === item.id ? (
                <View className="mt-3 gap-2 border-t border-line pt-3">
                  {matches.length === 0 ? (
                    <Text className="text-body text-muted">No matching rides right now.</Text>
                  ) : (
                    matches.map((ride) => (
                      <PressableScale
                        key={ride.id}
                        onPress={() => router.push(`/ride/${ride.id}` as never)}
                        className="flex-row items-center justify-between rounded-card bg-accentSoft px-3 py-2.5">
                        <View className="flex-1">
                          <Text className="font-semibold text-body text-accentStrong">
                            {ride.origin_label} → {ride.destination_label}
                          </Text>
                          <Text className="text-meta text-muted">
                            {rideSeatsLabel(ride)}
                          </Text>
                        </View>
                        <Text className="font-bold tabular-nums text-body text-accentStrong">{ride.price_per_seat} TND</Text>
                      </PressableScale>
                    ))
                  )}
                  <Button
                    title="Remove alert"
                    variant="danger"
                    size="sm"
                    className="self-end"
                    onPress={async () => {
                      await deleteInterest(item.id).catch(() => undefined);
                      await load();
                    }}
                  />
                </View>
              ) : null}
            </View>
          )}
        />
      )}

      <View className="gap-3 bg-surface px-5 py-4">
        <Text className="font-bold text-h text-fg">Add a route alert</Text>
        {(['from', 'to'] as const).map((end) => (
          <View key={end} className="gap-1.5">
            <Text className="font-semibold text-meta text-muted">{end === 'from' ? 'From' : 'To'}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-5">
              {CITIES.map((city) => (
                <PressableScale
                  key={city.name}
                  accessibilityRole="radio"
                  accessibilityLabel={`${end === 'from' ? 'From' : 'To'} ${city.name}`}
                  accessibilityState={{ checked: form[end]?.name === city.name }}
                  onPress={() => setForm({ ...form, [end]: city })}>
                  <Chip label={city.name} selected={form[end]?.name === city.name} size="sm" />
                </PressableScale>
              ))}
            </ScrollView>
          </View>
        ))}
        <Text className="text-meta text-faint">Matches rides leaving within 15 km of each city centre.</Text>
        <View className="flex-row gap-2">
          <Field label="Earliest (YYYY-MM-DD HH:MM)" className="flex-1" value={form.earliest} onChangeText={(t) => setForm({ ...form, earliest: t })} placeholder="2026-11-20 07:00" />
          <Field label="Latest" className="flex-1" value={form.latest} onChangeText={(t) => setForm({ ...form, latest: t })} placeholder="2026-11-20 10:00" />
        </View>
        {error ? <Text className="text-meta text-deal">{error}</Text> : null}
        <Button title="Save route alert" icon="notifications-outline" loading={creating} onPress={() => void create()} block />
      </View>
    </SafeAreaView>
  );
}
