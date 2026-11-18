import { format, isToday, isTomorrow, isYesterday } from 'date-fns';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { FlatList, ScrollView, SectionList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, EmptyState, Field, PressableScale, RideCard, SkeletonRideCard } from '@/components';
import { PointPicker, type Place } from '@/components/point-picker';
import { RidesMap } from '@/components/rides-map';
import { CITIES, CITY_RADIUS_KM } from '@/lib/places';
import { DAY_PARTS, dayStart, departureWindow, groupByDay, maxPriceError, type DayPart } from '@/lib/search';
import { listRides, type ListRidesParams, type RideOrdering, type RideScope, type RideWhen } from '@/services/rides';
import { useIsDriver, useSession } from '@/store/session';
import { ATMOSPHERES, type Atmosphere, type Ride } from '@/types';

const SCOPES: { label: string; value: RideScope; driverOnly?: boolean }[] = [
  { label: 'Find a ride', value: 'bookable' },
  { label: 'My rides', value: 'mine', driverOnly: true },
  { label: 'Joined', value: 'joined' },
];

const WHEN: { label: string; value: RideWhen; empty: Record<'mine' | 'joined', string> }[] = [
  {
    label: 'Upcoming',
    value: 'upcoming',
    empty: { mine: 'Rides you publish appear here until they start.', joined: 'Rides you book appear here until they start.' },
  },
  {
    label: 'In progress',
    value: 'active',
    empty: { mine: 'Start a ride from its page when you set off.', joined: 'Trips you are on right now appear here.' },
  },
  {
    label: 'Completed',
    value: 'completed',
    empty: { mine: 'Rides you finish driving appear here.', joined: 'Trips you finish appear here.' },
  },
  {
    label: 'Cancelled',
    value: 'cancelled',
    empty: { mine: 'Rides you cancel appear here.', joined: 'Cancelled rides you had booked appear here.' },
  },
];

const SORTS: { label: string; value: RideOrdering }[] = [
  { label: 'Soonest', value: 'departure' },
  { label: 'Cheapest', value: 'price' },
  { label: 'Closest pickup', value: 'pickup' },
];

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const SEATS = [1, 2, 3, 4];
const MAP_RADIUS_KM = 10;

interface Endpoint {
  label: string;
  lat: number;
  lng: number;
  radiusKm: number;
  city?: string;
}

interface Filters {
  from: Endpoint | null;
  to: Endpoint | null;
  day: number | null;
  part: DayPart;
  seats: number;
  maxPrice: string;
  ordering: RideOrdering;
  atmosphere: Atmosphere | null;
  shared: boolean;
}

const NO_FILTERS: Filters = {
  from: null, to: null, day: null, part: 'any', seats: 1, maxPrice: '', ordering: 'departure', atmosphere: null, shared: false,
};

interface Results {
  rides: Ride[];
  count: number;
  page: number;
  hasMore: boolean;
  error?: string;
}

function dayLabel(offset: number, now: Date): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return format(dayStart(now, offset), 'EEE d');
}

function sectionLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE d MMMM');
}

function activeFilterCount(f: Filters): number {
  return [f.day !== null, f.seats > 1, f.maxPrice, f.ordering !== 'departure', f.atmosphere, f.shared].filter(Boolean).length;
}

function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-5">
      {children}
    </ScrollView>
  );
}

function Option({ label, selected, onPress, hint }: { label: string; selected: boolean; onPress: () => void; hint: string }) {
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={hint} accessibilityState={{ selected }} onPress={onPress}>
      <Chip label={label} selected={selected} size="sm" />
    </PressableScale>
  );
}

function EndpointPicker({
  title,
  value,
  onChange,
}: {
  title: 'From' | 'To';
  value: Endpoint | null;
  onChange: (next: Endpoint | null) => void;
}) {
  const [onMap, setOnMap] = useState(false);
  const noun = title === 'From' ? 'pickup' : 'drop-off';
  const point: Place | null = value && !value.city ? { lat: value.lat, lng: value.lng, label: value.label } : null;

  return (
    <View className="gap-2">
      <Text className="font-semibold text-meta text-muted">{title}</Text>
      <ChipRow>
        <Option
          label="Anywhere"
          selected={!value && !onMap}
          hint={`Any ${noun}`}
          onPress={() => {
            setOnMap(false);
            onChange(null);
          }}
        />
        {CITIES.map((city) => (
          <Option
            key={city.name}
            label={city.name}
            selected={value?.city === city.name}
            hint={`${title} ${city.name}`}
            onPress={() => {
              setOnMap(false);
              onChange({ label: city.name, lat: city.lat, lng: city.lng, radiusKm: CITY_RADIUS_KM, city: city.name });
            }}
          />
        ))}
        <Option
          label="Point on map"
          selected={onMap || !!point}
          hint={`Set ${noun} on map`}
          onPress={() => {
            setOnMap(true);
            if (value?.city) onChange(null);
          }}
        />
      </ChipRow>
      {onMap || point ? (
        <View className="gap-1">
          <PointPicker
            title={`${title} point`}
            point={point}
            onPick={(p) => onChange({ label: p.label, lat: p.lat, lng: p.lng, radiusKm: MAP_RADIUS_KM })}
          />
          <Text className="text-meta text-faint">Rides within {MAP_RADIUS_KM} km of this point.</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Ride discovery (search, map, pages) plus the driver and passenger schedules. */
export default function RidesScreen() {
  const isDriver = useIsDriver();
  const hasInterests = (useSession((s) => s.user?.profile?.interests?.length) ?? 0) > 0;
  const scopes = SCOPES.filter((s) => !s.driverOnly || isDriver);
  const [scope, setScope] = useState<RideScope>('bookable');
  const [when, setWhen] = useState<RideWhen>('upcoming');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [priceText, setPriceText] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  // undefined = first page loading; the rest of the state survives "Show more".
  const [results, setResults] = useState<Results | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  // Remounts the route pickers so a cleared search also closes their map panels.
  const [resetKey, setResetKey] = useState(0);
  const requestId = useRef(0);
  const searching = scope === 'bookable';

  const fetchPage = useCallback(
    (page: number): Promise<Results> => {
      const params: ListRidesParams = searching
        ? {
            page,
            from: filters.from ?? undefined,
            to: filters.to ?? undefined,
            ...departureWindow(new Date(), filters.day, filters.part),
            maxPrice: filters.maxPrice || undefined,
            minSeats: filters.seats,
            ordering: filters.ordering,
            atmosphere: filters.atmosphere ?? undefined,
            // The toggle is hidden once the profile has no interests; don't keep filtering on it.
            sharedInterests: filters.shared && hasInterests,
          }
        : { scope, when, page };
      return listRides(params).then((res) => ({
        rides: res.results,
        count: res.count,
        page,
        hasMore: !!res.next,
      }));
    },
    [searching, scope, when, filters, hasInterests],
  );

  const load = useCallback(() => {
    const id = ++requestId.current;
    fetchPage(1)
      .then((next) => {
        if (id === requestId.current) setResults(next);
      })
      .catch((err) => {
        if (id !== requestId.current) return;
        const message = err instanceof Error ? err.message : 'Rides could not load.';
        setResults({ rides: [], count: 0, page: 1, hasMore: false, error: message });
      });
  }, [fetchPage]);

  // Refetch on focus: seats and statuses change while other screens are open.
  useFocusEffect(load);

  const reload = () => {
    setResults(undefined);
    load();
  };

  const loadMore = () => {
    if (!results?.hasMore || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    fetchPage(results.page + 1)
      .then((next) => {
        if (id !== requestId.current) return;
        setResults((prev) => {
          if (!prev) return next;
          const seen = new Set(prev.rides.map((r) => r.id));
          return { ...next, rides: [...prev.rides, ...next.rides.filter((r) => !seen.has(r.id))] };
        });
      })
      .catch(() => {
        if (id === requestId.current) setResults((prev) => prev && { ...prev, error: 'More rides could not load. Try again.' });
      })
      .finally(() => setLoadingMore(false));
  };

  const update = (patch: Partial<Filters>) => {
    setResults(undefined);
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      // Pickup distance is measured from the "From" point; without one it means nothing.
      if (!next.from && next.ordering === 'pickup') next.ordering = 'departure';
      return next;
    });
  };

  const applyPrice = () => {
    const error = maxPriceError(priceText);
    setPriceError(error);
    const value = error ? filters.maxPrice : priceText.trim().replace(',', '.');
    if (!error && value !== filters.maxPrice) update({ maxPrice: value });
  };

  const clearFilters = () => {
    setPriceText('');
    setPriceError(null);
    setResetKey((k) => k + 1);
    update(NO_FILTERS);
  };

  const openRide = (ride: Ride) => router.push(`/ride/${ride.id}` as never);
  const filterCount = activeFilterCount({ ...filters, shared: filters.shared && hasInterests });
  const narrowed = filterCount > 0 || !!filters.from || !!filters.to;
  const now = new Date();
  const rides = results?.rides ?? [];
  const currentWhen = WHEN.find((w) => w.value === when) ?? WHEN[0];

  const scopeBar = (
    <View className="mt-3 flex-row gap-2 px-5 pb-1">
      {scopes.map((s) => (
        <Option
          key={s.value}
          label={s.label}
          selected={scope === s.value}
          hint={`Show ${s.label.toLowerCase()}`}
          onPress={() => {
            if (s.value === scope) return;
            setResults(undefined);
            setScope(s.value);
          }}
        />
      ))}
    </View>
  );

  const footer = results?.hasMore ? (
    <Button
      title="Show more rides"
      variant="secondary"
      loading={loadingMore}
      onPress={loadMore}
      className="mt-1 self-center"
    />
  ) : null;

  const errorLine = results?.error && rides.length > 0 ? (
    <Text accessibilityRole="alert" className="text-center text-body text-deal">
      {results.error}
    </Text>
  ) : null;

  if (!searching) {
    const key = scope === 'mine' ? 'mine' : 'joined';
    const sections = groupByDay(rides);
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
        <View className="px-5 pt-3">
          <Text className="text-display font-bold text-fg">Rides</Text>
        </View>
        {scopeBar}
        <View className="mt-2 pl-5">
          <ChipRow>
            {WHEN.map((w) => (
              <Option
                key={w.value}
                label={w.label}
                selected={when === w.value}
                hint={`Show ${w.label.toLowerCase()} rides`}
                onPress={() => {
                  if (w.value === when) return;
                  setResults(undefined);
                  setWhen(w.value);
                }}
              />
            ))}
          </ChipRow>
        </View>
        {!results ? (
          <View className="gap-3">
            {[0, 1, 2].map((key) => (
              <SkeletonRideCard key={key} />
            ))}
          </View>
        ) : rides.length === 0 ? (
          <EmptyState
            icon={results.error ? 'cloud-offline-outline' : 'calendar-outline'}
            title={results.error ? 'Rides could not load' : `No ${currentWhen.label.toLowerCase()} rides`}
            message={results.error ?? currentWhen.empty[key]}
            actionLabel={results.error ? 'Try again' : undefined}
            onAction={results.error ? reload : undefined}
          />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(r) => r.id}
            stickySectionHeadersEnabled={false}
            contentContainerClassName="gap-3 px-5 pb-24 pt-2"
            showsVerticalScrollIndicator={false}
            renderSectionHeader={({ section }) => (
              <Text accessibilityRole="header" className="mt-2 font-semibold text-meta uppercase text-faint">
                {sectionLabel(section.date)}
              </Text>
            )}
            renderItem={({ item }) => <RideCard ride={item} showDriver={scope !== 'mine'} onPress={() => openRide(item)} />}
            ListFooterComponent={
              <View className="gap-2">
                {errorLine}
                {footer}
              </View>
            }
          />
        )}
      </SafeAreaView>
    );
  }

  const panel = (
    <View className="gap-4 pb-1">
      <EndpointPicker key={`from-${resetKey}`} title="From" value={filters.from} onChange={(from) => update({ from })} />
      <EndpointPicker key={`to-${resetKey}`} title="To" value={filters.to} onChange={(to) => update({ to })} />

      <View className="flex-row items-center justify-between">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={showFilters ? 'Hide filters' : 'Show filters'}
          accessibilityState={{ expanded: showFilters }}
          onPress={() => setShowFilters((v) => !v)}
          className="h-11 justify-center">
          <Text className="font-semibold text-body text-accentStrong">
            {showFilters ? 'Hide filters' : 'Date, seats, price and more'}
            {filterCount > 0 && !showFilters ? ` · ${filterCount} set` : ''}
          </Text>
        </PressableScale>
        {narrowed ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Clear filters"
            onPress={clearFilters}
            className="h-11 justify-center">
            <Text className="font-semibold text-body text-muted">Clear</Text>
          </PressableScale>
        ) : null}
      </View>

      {showFilters ? (
        <View className="gap-4">
          <View className="gap-2">
            <Text className="font-semibold text-meta text-muted">Day</Text>
            <ChipRow>
              <Option label="Any day" selected={filters.day === null} hint="Any day" onPress={() => update({ day: null, part: 'any' })} />
              {DAYS.map((offset) => {
                const label = dayLabel(offset, now);
                return (
                  <Option
                    key={offset}
                    label={label}
                    selected={filters.day === offset}
                    hint={`Leaving ${offset < 2 ? label.toLowerCase() : format(dayStart(now, offset), 'EEEE d MMMM')}`}
                    onPress={() => update({ day: offset })}
                  />
                );
              })}
            </ChipRow>
            {filters.day !== null ? (
              <ChipRow>
                {DAY_PARTS.map((p) => (
                  <Option
                    key={p.value}
                    label={p.label}
                    selected={filters.part === p.value}
                    hint={p.value === 'any' ? 'Any time that day' : `Leaving in the ${p.label.toLowerCase()}`}
                    onPress={() => update({ part: p.value })}
                  />
                ))}
              </ChipRow>
            ) : null}
          </View>

          <View className="gap-2">
            <Text className="font-semibold text-meta text-muted">Seats needed</Text>
            <View className="flex-row gap-2">
              {SEATS.map((n) => (
                <Option
                  key={n}
                  label={n === 4 ? '4+' : String(n)}
                  selected={filters.seats === n}
                  hint={`${n}${n === 4 ? ' or more' : ''} seat${n > 1 ? 's' : ''} needed`}
                  onPress={() => update({ seats: n })}
                />
              ))}
            </View>
          </View>

          <Field
            label="Max price per seat (TND)"
            placeholder="No limit"
            keyboardType="decimal-pad"
            returnKeyType="done"
            value={priceText}
            error={priceError ?? undefined}
            onChangeText={(text) => {
              setPriceText(text);
              if (priceError) setPriceError(null);
            }}
            onBlur={applyPrice}
            onSubmitEditing={applyPrice}
          />

          <View className="gap-2">
            <Text className="font-semibold text-meta text-muted">Ride atmosphere</Text>
            <ChipRow>
              <Option label="Any" selected={!filters.atmosphere} hint="Any ride atmosphere" onPress={() => update({ atmosphere: null })} />
              {ATMOSPHERES.map((a) => (
                <Option
                  key={a.value}
                  label={a.label}
                  selected={filters.atmosphere === a.value}
                  hint={`${a.label}, or rides where the driver did not say`}
                  onPress={() => update({ atmosphere: a.value })}
                />
              ))}
            </ChipRow>
            {filters.atmosphere ? <Text className="text-meta text-faint">Also shows rides where the driver didn’t choose one.</Text> : null}
          </View>

          <View className="gap-2">
            <Text className="font-semibold text-meta text-muted">Driver</Text>
            {hasInterests ? (
              <View className="flex-row gap-2">
                <Option label="Anyone" selected={!filters.shared} hint="Drivers with any interests" onPress={() => update({ shared: false })} />
                <Option label="Shares my interests" selected={filters.shared} hint="Only drivers who share one of my interests" onPress={() => update({ shared: true })} />
              </View>
            ) : (
              <PressableScale accessibilityRole="link" accessibilityLabel="Add interests to your profile" onPress={() => router.push('/profile')} className="min-h-11 justify-center">
                <Text className="text-body text-muted">
                  <Text className="font-semibold text-accentStrong">Add interests to your profile</Text> to find drivers who share them.
                </Text>
              </PressableScale>
            )}
          </View>

          <View className="gap-2">
            <Text className="font-semibold text-meta text-muted">Sort by</Text>
            <View className="flex-row flex-wrap gap-2">
              {SORTS.filter((s) => s.value !== 'pickup' || filters.from).map((s) => (
                <Option
                  key={s.value}
                  label={s.label}
                  selected={filters.ordering === s.value}
                  hint={`Sort by ${s.label.toLowerCase()}`}
                  onPress={() => update({ ordering: s.value })}
                />
              ))}
            </View>
          </View>
        </View>
      ) : null}

      <View className="flex-row items-center justify-between border-t border-line pt-3">
        <Text accessibilityLiveRegion="polite" className="font-semibold text-body text-fg">
          {!results ? 'Searching…' : results.error && rides.length === 0 ? '' : `${results.count} ride${results.count === 1 ? '' : 's'}`}
        </Text>
        <View className="flex-row gap-2">
          <Option label="List" selected={view === 'list'} hint="Show results as a list" onPress={() => setView('list')} />
          <Option label="Map" selected={view === 'map'} hint="Show results on a map" onPress={() => setView('map')} />
        </View>
      </View>
    </View>
  );

  const empty = !results ? (
    <View className="gap-3">
      {[0, 1, 2].map((key) => (
        <SkeletonRideCard key={key} />
      ))}
    </View>
  ) : results.error && rides.length === 0 ? (
    <EmptyState icon="cloud-offline-outline" title="Rides could not load" message={results.error} actionLabel="Try again" onAction={reload} />
  ) : rides.length === 0 ? (
    narrowed ? (
      <EmptyState
        icon="search-outline"
        title="No rides match"
        message="Try another day, a higher price limit, fewer seats or another atmosphere — or widen the route."
        actionLabel="Clear filters"
        onAction={clearFilters}
      />
    ) : (
      <EmptyState icon="map-outline" title="No open rides" message="No upcoming rides have free seats right now." />
    )
  ) : null;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-5 pt-3">
        <Text className="text-display font-bold text-fg">Rides</Text>
      </View>
      {scopeBar}
      <FlatList
        data={view === 'list' ? rides : []}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-3 px-5 pb-24 pt-2"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={panel}
        renderItem={({ item }) => <RideCard ride={item} onPress={() => openRide(item)} />}
        ListEmptyComponent={view === 'list' ? (empty ?? undefined) : undefined}
        ListFooterComponent={
          <View className="gap-3">
            {view === 'map' ? (empty ?? <RidesMap rides={rides} onSelect={openRide} />) : null}
            {errorLine}
            {footer}
          </View>
        }
      />
    </SafeAreaView>
  );
}
