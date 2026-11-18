import { formatDistanceToNow } from 'date-fns';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MOCK_ENABLED, MOCK_ROLES, setMockRole, type MockRole } from '@/api/mock';
import { Badge, Button, CountBadge, EmptyState, Fare, Icon, PressableScale, Skeleton } from '@/components';
import { formatTnd } from '@/lib/money';
import { CARD_SHADOW } from '@/lib/theme';
import { ledgerEntries, walletMe } from '@/services/wallet';
import { useNotifications } from '@/store/notifications';
import { useSession } from '@/store/session';
import type { LedgerEntry } from '@/types';

const KIND_ICON: Record<string, { name: 'arrow-down-circle-outline' | 'arrow-up-circle-outline' | 'gift-outline'; tone: string }> = {
  TOPUP: { name: 'arrow-down-circle-outline', tone: 'text-accent' },
  RIDE_PAYMENT: { name: 'arrow-up-circle-outline', tone: 'text-deal' },
  FARE_RECEIPT: { name: 'arrow-down-circle-outline', tone: 'text-accent' },
  SPONSOR_SUBSIDY: { name: 'gift-outline', tone: 'text-accent' },
  VOUCHER_REDEEM: { name: 'gift-outline', tone: 'text-accent' },
  REFUND: { name: 'arrow-down-circle-outline', tone: 'text-accent' },
};

/** Account: profile, wallet, verification status, become-driver, logout. */
export default function AccountScreen() {
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const refreshMe = useSession((s) => s.refreshMe);
  const signingOut = useSession((s) => s.authPending);
  const unread = useNotifications((s) => s.owner === user?.id ? s.unread : 0);
  const countError = useNotifications((s) => s.owner === user?.id ? s.countError : undefined);
  useFocusEffect(useCallback(() => {
    if (user?.id) void useNotifications.getState().refreshUnread(user.id);
  }, [user]));
  // undefined = still loading; value = loaded (balance may legitimately be null).
  const [wallet, setWallet] = useState<{ balance: string | null; entries: LedgerEntry[] } | undefined>(undefined);
  const [switching, setSwitching] = useState<MockRole | null>(null);
  const loading = wallet === undefined;

  const switchRole = async (role: MockRole) => {
    if (switching) return;
    setSwitching(role);
    try {
      setMockRole(role);
      await refreshMe();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not switch role');
    } finally {
      setSwitching(null);
    }
  };

  const load = useCallback(() => {
    Promise.all([
      walletMe().catch(() => null),
      ledgerEntries().catch(() => null),
    ]).then(([w, ledger]) => {
      setWallet({ balance: w?.balance ?? null, entries: ledger?.results.slice(0, 5) ?? [] });
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
        <EmptyState icon="person-outline" title="Not logged in" actionLabel="Log in" onAction={() => router.replace('/(auth)/phone')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView contentContainerClassName="pb-24" showsVerticalScrollIndicator={false}>
        <View className="px-5 pt-3">
          <Text className="text-display font-bold text-fg">Account</Text>
        </View>

        {/* Profile */}
        <View
          style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
          className="mx-5 mt-4 rounded-card bg-surface p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="font-semibold text-title text-fg">
                {user.profile?.full_name || user.phone_number || user.email}
              </Text>
              <Text className="text-meta text-muted">{user.phone_number || user.email}</Text>
            </View>
            <Badge label={user.role} tone={user.role === 'DRIVER' ? 'accent' : 'soft'} />
          </View>
          <View className="mt-3 flex-row items-center gap-4 border-t border-line pt-3">
            <View className="flex-row items-center gap-1">
              <Icon name="star" size={16} className="text-warning" />
              <Text className="font-bold text-body text-fg">{user.profile?.average_rating ?? '—'}</Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Icon
                name={user.is_verified ? 'shield-checkmark' : 'shield-outline'}
                size={16}
                className={user.is_verified ? 'text-accent' : 'text-faint'}
              />
              <Text className="text-meta text-muted">{user.is_verified ? 'Identity verified' : 'Not verified'}</Text>
            </View>
          </View>
          <Button title="Edit profile" icon="person-outline" variant="secondary" size="sm" className="mt-3" onPress={() => router.push('/profile')} />
          <Button title="Verification centre" icon="shield-checkmark-outline" variant="ghost" size="sm" className="mt-2" onPress={() => router.push('/verification')} />
        </View>

        <View style={CARD_SHADOW} className="mx-5 mt-3 rounded-card bg-surface">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Notifications, ${unread} unread${countError ? ', count may be out of date' : ''}`}
            className="min-h-14 flex-row items-center gap-3 rounded-card p-4"
            onPress={() => router.push('/notifications')}>
            <Icon name="notifications-outline" size={22} className="text-accentStrong" />
            <View className="flex-1">
              <Text className="text-title font-semibold text-fg">Notifications</Text>
              <Text className="text-meta text-muted">Inbox and delivery preferences</Text>
            </View>
            <CountBadge count={unread} />
            <Icon name="chevron-forward" size={20} className="text-muted" />
          </PressableScale>
          {countError ? <Text accessibilityLiveRegion="polite" className="px-4 pb-4 text-meta text-deal">{countError}</Text> : null}
        </View>

        {/* Wallet */}
        <View
          style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
          className="mx-5 mt-3 rounded-card bg-surface p-4">
          <Text className="font-semibold text-meta text-muted">Wallet balance</Text>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-32" />
          ) : (
            <Fare amount={wallet.balance} size="lg" tone="accent" className="mt-1" />
          )}
          {wallet && wallet.entries.length > 0 ? (
            <View className="mt-3 gap-2 border-t border-line pt-3">
              {wallet.entries.map((entry) => {
                const kind = KIND_ICON[entry.kind] ?? { name: 'swap-horizontal-outline' as const, tone: 'text-muted' };
                const n = Number(entry.amount);
                return (
                  <View key={entry.id} className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <Icon name={kind.name} size={18} className={kind.tone} />
                      <View>
                        <Text className="text-body font-medium text-fg">{entry.kind.replace(/_/g, ' ').toLowerCase()}</Text>
                        <Text className="text-meta text-faint">
                          {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                        </Text>
                      </View>
                    </View>
                    <Text className={`font-semibold text-body tabular-nums ${n < 0 ? 'text-deal' : 'text-accent'}`}>
                      {formatTnd(entry.amount)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
          <Button title="Open wallet" icon="wallet-outline" variant="secondary" size="sm" className="mt-3" onPress={() => router.push('/wallet')} />
        </View>

        {/* Driver upgrade */}
        {!user.is_verified ? (
          <View
            style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
            className="mx-5 mt-3 rounded-card bg-surface p-4">
            <View className="flex-row items-center gap-2">
              <Icon name="id-card-outline" size={20} className="text-warning" />
              <Text className="font-semibold text-title text-fg">Verify your identity</Text>
            </View>
            <Text className="mt-1 text-body text-muted">
              Submit your CIN for staff review when identity uploads are enabled. Driver mode
              requires an approved identity document.
            </Text>
            <Button
              title="Verification centre"
              icon="cloud-upload-outline"
              variant="secondary"
              size="sm"
              className="mt-3 self-start"
              onPress={() => router.push('/verification')}
            />
          </View>
        ) : null}

        {user.is_verified && user.role === 'PASSENGER' ? (
          <View className="mx-5 mt-3">
            <Button
              title="Become a driver"
              icon="car-sport-outline"
              variant="secondary"
              onPress={async () => {
                const { becomeDriver } = await import('@/services/users');
                try {
                  await becomeDriver();
                  await refreshMe();
                  alert('You are now a driver — publish your first ride!');
                  router.push('/vehicles');
                } catch (err) {
                  alert(err instanceof Error ? err.message : 'Could not upgrade to driver');
                }
              }}
              block
            />
          </View>
        ) : null}

        {user.role === 'DRIVER' ? (
          <View className="mx-5 mt-3 gap-3">
            <Button title="My vehicles" icon="car-outline" variant="secondary" onPress={() => router.push('/vehicles')} block />
            <Button
              title="Offer a ride"
              icon="car-sport-outline"
              onPress={() => router.push('/ride/publish')}
              block
            />
          </View>
        ) : null}

        {MOCK_ENABLED ? (
          <View className="mx-5 mt-3 rounded-card border border-dashed border-line bg-surface/60 p-4">
            <View className="flex-row items-center gap-2">
              <Icon name="flask-outline" size={18} className="text-warning" />
              <Text className="font-semibold text-title text-fg">Mock role</Text>
            </View>
            <Text className="mt-1 text-body text-muted">
              Offline fixtures only. Switching re-seeds rides, bookings and chats for the persona.
            </Text>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {MOCK_ROLES.map((role) => (
                <Button
                  key={role}
                  title={role}
                  size="sm"
                  variant={user.role === role ? 'primary' : 'secondary'}
                  loading={switching === role}
                  disabled={switching !== null}
                  onPress={() => void switchRole(role)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View className="mx-5 mt-3">
          <Button title="Log out" icon="log-out-outline" variant="danger" loading={signingOut} onPress={() => void signOut()} block />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
