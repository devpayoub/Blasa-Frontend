import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, EmptyState, PressableScale, ScreenHeader, Spinner } from '@/components';
import { disableDevicePush, ensurePushRegistration, notificationDate, notificationLink, pushUnavailableMessage } from '@/lib/notifications';
import { CARD_SHADOW, useThemeColors } from '@/lib/theme';
import { listNotifications, markAllNotificationsRead, markNotificationRead, updateNotificationPreferences, type NotificationPreferencePatch } from '@/services/wallet';
import { useNotifications } from '@/store/notifications';
import { useSession } from '@/store/session';
import type { Notification, Page } from '@/types';

function ErrorMessage({ children }: { children: string }) {
  return <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="mt-2 text-body text-deal">{children}</Text>;
}

function Inbox({ owner, language }: { owner: string; language: string }) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<Page<Notification>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState<string>();
  const [actionError, setActionError] = useState<{ id: string; message: string }>();
  const [notice, setNotice] = useState<string>();
  const sequence = useRef(0);
  const alive = useRef(true);
  const unread = useNotifications((s) => s.owner === owner ? s.unread : 0);
  const countError = useNotifications((s) => s.owner === owner ? s.countError : undefined);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; sequence.current += 1; };
  }, []);

  const load = useCallback(async () => {
    const version = ++sequence.current;
    setLoading(true);
    setError(undefined);
    try {
      const result = await listNotifications({ page, unread: unreadOnly });
      if (!alive.current || sequence.current !== version || useNotifications.getState().owner !== owner) return;
      setResponse(result);
    } catch {
      if (alive.current && sequence.current === version) setError('Could not load your inbox. Check your connection and retry.');
    } finally {
      if (alive.current && sequence.current === version) setLoading(false);
    }
  }, [owner, page, unreadOnly]);

  useFocusEffect(useCallback(() => {
    void load();
    void useNotifications.getState().refreshUnread(owner);
    return () => { sequence.current += 1; };
  }, [load, owner]));

  const act = async (id: string) => {
    if (working) return;
    setWorking(id);
    setActionError(undefined);
    setNotice(undefined);
    try {
      if (id === 'all') {
        const { updated } = await markAllNotificationsRead();
        if (!alive.current || useNotifications.getState().owner !== owner) return;
        setNotice(`${updated} notification${updated === 1 ? '' : 's'} marked as read.`);
      } else {
        await markNotificationRead(id);
        if (!alive.current || useNotifications.getState().owner !== owner) return;
        setNotice('Notification marked as read.');
      }
      await useNotifications.getState().refreshUnread(owner);
      if (!alive.current || useNotifications.getState().owner !== owner) return;
      if (unreadOnly && page > 1) { setResponse(undefined); setPage(1); }
      else await load();
    } catch {
      if (alive.current) setActionError({ id, message: 'Could not mark as read. Please retry.' });
    } finally {
      if (alive.current) setWorking(undefined);
    }
  };

  const chooseFilter = (value: boolean) => {
    setResponse(undefined);
    setLoading(true);
    setPage(1);
    setUnreadOnly(value);
    setActionError(undefined);
    setNotice(undefined);
  };
  const changePage = (value: number) => {
    setResponse(undefined);
    setLoading(true);
    setPage(value);
    setActionError(undefined);
    setNotice(undefined);
  };

  return (
    <FlatList
      data={loading || error ? [] : response?.results ?? []}
      keyExtractor={(item) => item.id}
      contentContainerClassName="px-5 pb-8"
      ListHeaderComponent={
        <View className="gap-3 pb-4">
          <View className="flex-row flex-wrap items-center justify-between gap-3">
            <Text accessibilityRole="header" className="text-h font-bold text-fg">Your inbox</Text>
            <Badge label={`${unread} unread`} tone="soft" />
          </View>
          <View className="flex-row gap-2" accessibilityRole="tablist">
            {[false, true].map((value) => (
              <PressableScale
                key={String(value)}
                accessibilityRole="tab"
                accessibilityLabel={value ? 'Unread notifications' : 'All notifications'}
                accessibilityState={{ selected: unreadOnly === value, disabled: !!working }}
                disabled={!!working}
                onPress={() => { if (value !== unreadOnly) chooseFilter(value); }}
                className={`min-h-12 flex-1 items-center justify-center rounded-pill px-4 ${unreadOnly === value ? 'bg-fg' : 'bg-surface'}`}>
                <Text className={`text-body font-semibold ${unreadOnly === value ? 'text-bg' : 'text-fg'}`}>{value ? 'Unread' : 'All'}</Text>
              </PressableScale>
            ))}
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button title="Mark all as read" variant="secondary" loading={working === 'all'} disabled={!!working || loading || (unread === 0 && !countError && !response?.results.some((item) => !item.read_at))} onPress={() => void act('all')} />
            <Button title="Refresh inbox" variant="ghost" disabled={loading || !!working} onPress={() => { void load(); void useNotifications.getState().refreshUnread(owner); }} />
          </View>
          {countError ? <ErrorMessage>{countError}</ErrorMessage> : null}
          {actionError?.id === 'all' ? <ErrorMessage>{actionError.message}</ErrorMessage> : null}
          {notice ? <Text accessibilityLiveRegion="polite" className="text-body text-fg">{notice}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? (
        <View accessibilityState={{ busy: true }} accessibilityLabel="Loading notifications" className="items-center gap-3 py-12">
          <Spinner /><Text className="text-body text-muted">Loading notifications…</Text>
        </View>
      ) : error ? (
        <View className="items-start pb-6">
          <ErrorMessage>{error}</ErrorMessage>
          <Button title="Retry inbox" className="mt-3" onPress={() => void load()} />
          {page > 1 ? <Button title="Back to first page" variant="secondary" className="mt-3" onPress={() => changePage(1)} /> : null}
        </View>
      ) : (
        <EmptyState icon="notifications-outline" title={unreadOnly ? 'You’re all caught up' : 'No notifications yet'} message={unreadOnly ? 'There are no unread notifications.' : 'Trip updates and account activity will appear here.'} />
      )}
      renderItem={({ item }) => {
        const target = notificationLink(item.kind, item.payload);
        const payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload) ? item.payload as Record<string, unknown> : {};
        const expiry = notificationDate(payload.expires_at, language, true);
        const created = notificationDate(item.created_at, language);
        return (
          <View style={CARD_SHADOW} className="mb-3 rounded-card bg-surface p-4">
            <View className="flex-row flex-wrap items-center gap-2">
              <Badge label={item.read_at ? 'Read' : 'Unread'} tone={item.read_at ? 'soft' : 'accent'} />
              {created ? <Text className="text-meta text-muted">{created}</Text> : null}
            </View>
            <Text accessibilityRole="header" className="mt-3 text-title font-semibold text-fg">{item.title}</Text>
            <Text className="mt-2 text-body leading-6 text-fg">{item.body}</Text>
            {expiry ? <Text className="mt-2 text-body text-muted">Expires: {expiry}</Text> : null}
            <View className="mt-3 flex-row flex-wrap gap-2">
              {target ? <Button title="View details" accessibilityLabel={`View details: ${item.title}`} variant="secondary" disabled={!!working} onPress={() => router.push(target)} /> : null}
              {!item.read_at ? <Button title="Mark as read" accessibilityLabel={`Mark as read: ${item.title}`} variant="ghost" loading={working === item.id} disabled={!!working} onPress={() => void act(item.id)} /> : null}
            </View>
            {actionError?.id === item.id ? <ErrorMessage>{actionError.message}</ErrorMessage> : null}
          </View>
        );
      }}
      ListFooterComponent={!loading && !error && response ? (
        <View className="mt-2 gap-3">
          <Text className="text-center text-meta text-muted">Page {page} · {response.count} notification{response.count === 1 ? '' : 's'}</Text>
          <View className="flex-row justify-between gap-3">
            <Button title="Previous page" variant="secondary" disabled={!response.previous || !!working} onPress={() => changePage(Math.max(1, page - 1))} />
            <Button title="Next page" variant="secondary" disabled={!response.next || !!working} onPress={() => changePage(page + 1)} />
          </View>
        </View>
      ) : undefined}
    />
  );
}

type PreferenceKey = keyof NotificationPreferencePatch;

function Preferences({ owner }: { owner: string }) {
  const colors = useThemeColors();
  const preferences = useNotifications((s) => s.owner === owner ? s.preferences : undefined);
  const loadError = useNotifications((s) => s.owner === owner ? s.preferencesError : undefined);
  const pushMessage = useNotifications((s) => s.owner === owner ? s.pushMessage : undefined);
  const preferencesBusy = useNotifications((s) => s.owner === owner && s.preferencesBusy);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<PreferenceKey>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const alive = useRef(true);
  const emailVerified = useSession((s) => !!s.user?.email && !!s.user.email_verified_at);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await useNotifications.getState().loadPreferences(owner);
    if (alive.current) setLoading(false);
  }, [owner]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const save = async (key: PreferenceKey, enabled: boolean) => {
    if (!preferences || useNotifications.getState().preferencesBusy) return;
    const epoch = useNotifications.getState().epoch;
    useNotifications.getState().setPreferencesBusy(owner, true);
    setWorking(key);
    setError(undefined);
    setNotice(undefined);
    const stillOwned = () => useNotifications.getState().owner === owner && useNotifications.getState().epoch === epoch;
    try {
      if (key === 'push_enabled' && enabled) {
        try { await ensurePushRegistration(owner, preferences, true); }
        catch (err) {
          if (stillOwned() && alive.current) setError(err instanceof Error ? err.message : 'Push registration failed. Please retry.');
          return;
        }
        if (!stillOwned()) return;
      }
      // Finish a started opt-in even if the user switches tabs; never leave an orphan registration.
      const updated = await updateNotificationPreferences({ [key]: enabled });
      if (!stillOwned()) return;
      useNotifications.getState().setPreferences(owner, updated);
      if (alive.current) setNotice('Preferences saved. This does not confirm delivery.');
      if (key === 'push_enabled' && !enabled) {
        try {
          await disableDevicePush(owner);
          if (stillOwned()) useNotifications.getState().setPushMessage(owner, 'Push is off for this account. Your inbox remains on.');
        } catch {
          if (stillOwned()) useNotifications.getState().setPushMessage(owner, 'Push is off, but device cleanup failed. Reconnect and retry cleanup.');
          if (stillOwned() && alive.current) setError('Push preference is off, but device cleanup failed. Reconnect and retry cleanup before signing out.');
        }
      }
    } catch {
      if (stillOwned() && alive.current) setError('Could not save preferences. Please retry.');
      if (key === 'push_enabled' && enabled && stillOwned()) await disableDevicePush(owner).catch(() => undefined);
    } finally {
      if (stillOwned()) useNotifications.getState().setPreferencesBusy(owner, false);
      if (alive.current) setWorking(undefined);
    }
  };

  const retryPush = async () => {
    if (!preferences || useNotifications.getState().preferencesBusy) return;
    const epoch = useNotifications.getState().epoch;
    useNotifications.getState().setPreferencesBusy(owner, true);
    setWorking('push_enabled');
    setError(undefined);
    try {
      if (preferences.push_enabled) await ensurePushRegistration(owner, preferences, true);
      else await disableDevicePush(owner);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : 'Device setup unavailable. Please retry.');
    } finally {
      if (useNotifications.getState().owner === owner && useNotifications.getState().epoch === epoch) useNotifications.getState().setPreferencesBusy(owner, false);
      if (alive.current) setWorking(undefined);
    }
  };

  const unavailable = pushUnavailableMessage(preferences);
  const rows: { key: PreferenceKey; title: string; description: string; disabled: boolean }[] = preferences ? [
    { key: 'promotions_enabled', title: 'Promotions & rewards', description: 'Opt in to promotional award notices. Turning this off does not remove existing inbox messages.', disabled: false },
    { key: 'push_enabled', title: 'Push notifications', description: unavailable ?? 'Requires permission and device registration on a physical-device development build. Delivery is not guaranteed.', disabled: !!unavailable && !preferences.push_enabled },
    { key: 'email_enabled', title: 'Email notifications', description: !preferences.capabilities.email ? 'Email delivery is not configured on the server.' : !emailVerified ? 'Verify your email in your profile before opting in.' : 'Receive account updates at your verified email address.', disabled: (!preferences.capabilities.email || !emailVerified) && !preferences.email_enabled },
    { key: 'sms_enabled', title: 'SMS notifications', description: 'SMS is unavailable. No SMS adapter is configured.', disabled: true },
  ] : [];

  return (
    <ScrollView contentContainerClassName="px-5 pb-8" showsVerticalScrollIndicator={false}>
      <Text accessibilityRole="header" className="text-h font-bold text-fg">Delivery preferences</Text>
      <View style={CARD_SHADOW} className="mt-4 rounded-card bg-surface p-4">
        <Text className="text-title font-semibold text-fg">Inbox · Always on</Text>
        <Text className="mt-2 text-body leading-6 text-muted">Account and trip updates stay in your inbox. Optional channels and promotions are off by default.</Text>
      </View>
      {loading ? <View accessibilityState={{ busy: true }} className="my-4 flex-row items-center gap-3"><Spinner /><Text className="text-body text-muted">Loading preferences…</Text></View> : null}
      {loadError ? <ErrorMessage>{loadError}</ErrorMessage> : null}
      {!preferences || loadError ? <Button title="Retry preferences" variant="secondary" className="mt-3" loading={loading} onPress={() => void load()} /> : null}
      {rows.map((row) => {
        const disabled = row.disabled || loading || preferencesBusy;
        return (
          <View key={row.key} style={CARD_SHADOW} className="mt-3 rounded-card bg-surface p-4">
            <View className="flex-row items-center gap-3">
              <Text className="flex-1 text-title font-semibold text-fg">{row.title}</Text>
              <Switch
                accessibilityLabel={row.title}
                accessibilityHint={row.description}
                accessibilityState={{ checked: !!preferences?.[row.key], disabled, busy: working === row.key }}
                aria-checked={!!preferences?.[row.key]}
                aria-disabled={disabled}
                aria-busy={working === row.key}
                value={!!preferences?.[row.key]}
                disabled={disabled}
                onValueChange={(enabled) => void save(row.key, enabled)}
                trackColor={{ false: colors.line, true: colors.accent }}
                thumbColor={colors.surface}
                ios_backgroundColor={colors.line}
                style={{ minHeight: 48, opacity: disabled ? 0.5 : 1 }}
              />
            </View>
            <Text className="mt-2 text-body leading-6 text-muted">{row.description}</Text>
            {working === row.key ? <Text accessibilityLiveRegion="polite" className="mt-2 text-meta text-muted">Saving…</Text> : null}
          </View>
        );
      })}
      {pushMessage ? <Text accessibilityLiveRegion="polite" className="mt-4 text-body text-muted">{pushMessage}</Text> : null}
      {preferences && ((!unavailable && preferences.push_enabled) || (!preferences.push_enabled && pushMessage)) ? (
        <Button title={preferences.push_enabled ? 'Retry device setup' : 'Retry device cleanup'} variant="secondary" className="mt-3" loading={working === 'push_enabled'} disabled={preferencesBusy || loading} onPress={() => void retryPush()} />
      ) : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {notice ? <Text accessibilityLiveRegion="polite" className="mt-3 text-body text-fg">{notice}</Text> : null}
      <Text className="mt-4 text-meta leading-5 text-muted">Sign out while online to remove this device from server delivery queues. Offline cleanup is best effort; notifications already handed to a push provider cannot be recalled.</Text>
    </ScrollView>
  );
}

export default function NotificationsScreen() {
  const user = useSession((s) => s.access ? s.user : undefined);
  const owner = useNotifications((s) => s.owner);
  const [tab, setTab] = useState<'inbox' | 'preferences'>('inbox');
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title="Notifications" />
      {!user ? (
        <EmptyState icon="notifications-outline" title="Log in to view notifications" actionLabel="Log in" onAction={() => router.replace('/(auth)/phone')} />
      ) : owner !== user.id ? (
        <View className="flex-1 items-center justify-center gap-3"><Spinner /><Text className="text-body text-muted">Preparing your inbox…</Text></View>
      ) : (
        <>
          <View className="mx-5 mb-5 mt-2 flex-row gap-2" accessibilityRole="tablist">
            {(['inbox', 'preferences'] as const).map((value) => (
              <PressableScale key={value} accessibilityRole="tab" accessibilityLabel={value === 'inbox' ? 'Inbox' : 'Preferences'} accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} className={`min-h-12 flex-1 items-center justify-center rounded-pill px-4 ${tab === value ? 'bg-accent' : 'bg-surface'}`}>
                <Text className={`text-body font-semibold ${tab === value ? 'text-onAccent' : 'text-fg'}`}>{value === 'inbox' ? 'Inbox' : 'Preferences'}</Text>
              </PressableScale>
            ))}
          </View>
          {tab === 'inbox' ? <Inbox key={owner} owner={owner} language={user.preferred_language || 'en'} /> : <Preferences key={owner} owner={owner} />}
        </>
      )}
    </SafeAreaView>
  );
}
