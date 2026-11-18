import { format } from 'date-fns';
import * as WebBrowser from 'expo-web-browser';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { Button, Chip, EmptyState, Fare, Field, Icon, PressableScale, ScreenHeader, Spinner } from '@/components';
import { formatTnd } from '@/lib/money';
import { CARD_SHADOW } from '@/lib/theme';
import {
  cancelPaymentIntent, claimVoucher, createTopup, getPaymentIntent, ledgerEntries, listPaymentIntents,
  listRewards, listVouchers, walletEarnings, walletMe,
} from '@/services/wallet';
import { useSession } from '@/store/session';
import type {
  AuthUser, DriverEarnings, IncentiveAward, LedgerEntry, Page, PaymentIntent, PaymentIntentStatusEnum, Voucher,
} from '@/types';

const QUICK_AMOUNTS = ['10', '20', '50'];

const HISTORY_FILTERS: { label: string; kinds: string[] }[] = [
  { label: 'All', kinds: [] },
  { label: 'Top-ups', kinds: ['TOPUP'] },
  { label: 'Rides', kinds: ['RIDE_PAYMENT'] },
  { label: 'Refunds', kinds: ['REFUND'] },
  { label: 'Offers', kinds: ['VOUCHER_REDEEM', 'VOUCHER_REDEEM_REVERSAL', 'SPONSOR_SUBSIDY', 'SPONSOR_SUBSIDY_REVERSAL'] },
];

const INTENT_STATUS: Record<PaymentIntentStatusEnum, { label: string; hint: string; tone: string }> = {
  PENDING: { label: 'Waiting for Flouci', hint: 'Finish paying in the Flouci page. Your balance updates once Flouci confirms the payment.', tone: 'text-warning' },
  PAID: { label: 'Added to your wallet', hint: 'Flouci confirmed this payment.', tone: 'text-accentStrong' },
  FAILED: { label: 'Payment failed', hint: 'Nothing was charged. You can try again.', tone: 'text-deal' },
  CANCELLED: { label: 'Cancelled', hint: 'If Flouci still confirms a payment for this attempt, the amount is added to your wallet.', tone: 'text-muted' },
};

function entryLabel(entry: LedgerEntry): string {
  const incoming = Number(entry.amount) >= 0;
  switch (entry.kind) {
    case 'TOPUP': return 'Wallet top-up';
    case 'RIDE_PAYMENT': return incoming ? 'Fare received' : 'Seat payment';
    case 'REFUND': return incoming ? 'Refund' : 'Fare refunded to passenger';
    case 'VOUCHER_REDEEM': return 'Voucher applied';
    case 'VOUCHER_REDEEM_REVERSAL': return 'Voucher returned';
    case 'SPONSOR_SUBSIDY': return 'Sponsored discount';
    case 'SPONSOR_SUBSIDY_REVERSAL': return 'Sponsored discount returned';
    default: return entry.description || entry.kind.replace(/_/g, ' ').toLowerCase();
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'd MMM yyyy, HH:mm');
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && /network|fetch|abort/i.test(error.message)) return 'Cannot reach the server. Check your connection and retry.';
  return error instanceof Error ? error.message : 'Could not complete this request. Please retry.';
}

function validAmount(raw: string): string | null {
  const value = raw.trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(value)) return null;
  return Number(value) >= 1 ? value : null;
}

function rewardCopy(award: IncentiveAward): { title: string; hint: string } {
  const expires = formatDate(award.expires_at);
  if (award.kind === 'WELCOME_CREDIT') {
    const hint = award.status === 'REDEEMED' ? 'Used on a booking.'
      : award.status === 'EXPIRED' ? `Expired ${expires}.`
        : award.status === 'REVOKED' ? 'This credit was withdrawn.'
          : `Applied automatically when you pay for your next booking. Expires ${expires}.`;
    return { title: `Welcome credit · ${formatTnd(award.amount)}`, hint };
  }
  const hint = award.status === 'REDEEMED' ? `Used ${formatDate(award.redeemed_at)}.`
    : award.status === 'EXPIRED' ? `Expired ${expires}.`
      : award.status === 'REVOKED' ? 'This reward was withdrawn.'
        : `Show code ${award.code} at a partner station. Expires ${expires}.`;
  return { title: `Fuel reward · ${formatTnd(award.amount)}`, hint };
}

export default function WalletScreen() {
  const user = useSession((state) => state.user);
  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="Wallet" />
        <EmptyState icon="wallet-outline" title="Not logged in" message="Log in to see your balance and payments." actionLabel="Log in" onAction={() => router.replace('/(auth)/phone')} />
      </SafeAreaView>
    );
  }
  return <Wallet key={user.id} user={user} />;
}

function Wallet({ user }: { user: AuthUser }) {
  const isDriver = user.role === 'DRIVER';
  const [balance, setBalance] = useState<string | null | undefined>(undefined);
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [rewards, setRewards] = useState<IncentiveAward[]>([]);
  const [earnings, setEarnings] = useState<DriverEarnings | null>(null);
  const [summaryError, setSummaryError] = useState('');

  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState('');
  const [topupError, setTopupError] = useState('');
  const [starting, setStarting] = useState(false);
  const [active, setActive] = useState<PaymentIntent | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeNotice, setCodeNotice] = useState('');
  const [claiming, setClaiming] = useState(false);

  const [filter, setFilter] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [history, setHistory] = useState<Page<LedgerEntry> | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const mounted = useRef(true);
  const activeId = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const loadSummary = useCallback(() => {
    void Promise.allSettled([
      walletMe(), listPaymentIntents(), listVouchers(), listRewards(),
      isDriver ? walletEarnings() : Promise.resolve(null),
    ]).then(([wallet, intentPage, voucherPage, rewardPage, earned]) => {
      if (!mounted.current) return;
      setBalance(wallet.status === 'fulfilled' ? wallet.value.balance : null);
      if (intentPage.status === 'fulfilled') setIntents(intentPage.value.results.slice(0, 3));
      if (voucherPage.status === 'fulfilled') setVouchers(voucherPage.value.results);
      if (rewardPage.status === 'fulfilled') setRewards(rewardPage.value.results);
      if (earned.status === 'fulfilled') setEarnings(earned.value);
      const failed = [wallet, intentPage, voucherPage, rewardPage, earned].find((result) => result.status === 'rejected');
      setSummaryError(failed?.status === 'rejected' ? errorMessage(failed.reason) : '');
    });
  }, [isDriver]);

  const loadHistory = useCallback(() => {
    ledgerEntries({ kinds: HISTORY_FILTERS[filter].kinds, page: pageNumber }).then((page) => {
      if (!mounted.current) return;
      setHistory(page);
      setHistoryError('');
    }).catch((error: unknown) => {
      if (mounted.current) setHistoryError(errorMessage(error));
    }).finally(() => {
      if (mounted.current) setHistoryLoading(false);
    });
  }, [filter, pageNumber]);

  const checkActive = useCallback(async () => {
    const id = activeId.current;
    if (!id) return;
    setChecking(true);
    try {
      const intent = await getPaymentIntent(id);
      if (!mounted.current || activeId.current !== id) return;
      setActive(intent);
      if (intent.status !== 'PENDING') {
        loadSummary();
        loadHistory();
      }
    } catch (error) {
      if (mounted.current) setTopupError(errorMessage(error));
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, [loadHistory, loadSummary]);

  useFocusEffect(useCallback(() => {
    loadSummary();
    void checkActive();
  }, [checkActive, loadSummary]));

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Returning from the Flouci page (another tab or the in-app browser) re-checks the attempt.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkActive();
    });
    return () => subscription.remove();
  }, [checkActive]);

  async function openPayment(url: string) {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      setTopupError('Could not open the Flouci page. Use "Open Flouci page" to try again.');
    }
    await checkActive();
  }

  async function startTopup() {
    if (starting) return;
    const value = validAmount(amount);
    setTopupError('');
    if (!value) {
      setAmountError('Enter an amount of at least 1 TND, with up to 3 decimals.');
      return;
    }
    setAmountError('');
    setStarting(true);
    try {
      const result = await createTopup(value);
      if (!mounted.current) return;
      activeId.current = result.id;
      setActive(result);
      setPaymentUrl(result.payment_url ?? null);
      setAmount('');
      if (result.status !== 'PENDING') loadSummary();
      else if (result.payment_url) void openPayment(result.payment_url);
    } catch (error) {
      if (!mounted.current) return;
      const failed = error instanceof ApiError ? (error.body as { intent?: PaymentIntent } | undefined)?.intent : undefined;
      if (failed) {
        activeId.current = failed.id;
        setActive(failed);
        setPaymentUrl(null);
        loadSummary();
      }
      setTopupError(errorMessage(error));
    } finally {
      if (mounted.current) setStarting(false);
    }
  }

  async function cancelActive() {
    if (!active || cancelling) return;
    setCancelling(true);
    setTopupError('');
    try {
      const intent = await cancelPaymentIntent(active.id);
      if (mounted.current) setActive(intent);
      loadSummary();
    } catch (error) {
      if (mounted.current) {
        setTopupError(errorMessage(error));
        void checkActive();
      }
    } finally {
      if (mounted.current) setCancelling(false);
    }
  }

  async function claim() {
    if (claiming) return;
    const value = code.trim();
    setCodeNotice('');
    if (!value) {
      setCodeError('Enter the code you received.');
      return;
    }
    setCodeError('');
    setClaiming(true);
    try {
      const voucher = await claimVoucher(value);
      if (!mounted.current) return;
      setCode('');
      setCodeNotice(`Code ${voucher.code} added: ${formatTnd(voucher.amount)} off your next booking payment.`);
      loadSummary();
    } catch (error) {
      if (mounted.current) setCodeError(errorMessage(error));
    } finally {
      if (mounted.current) setClaiming(false);
    }
  }

  function chooseFilter(index: number) {
    if (index === filter) return;
    setHistoryLoading(true);
    setFilter(index);
    setPageNumber(1);
  }

  function goToPage(page: number) {
    if (page < 1 || historyLoading) return;
    setHistoryLoading(true);
    setPageNumber(page);
  }

  function retryHistory() {
    setHistoryLoading(true);
    setHistoryError('');
    loadHistory();
  }

  const status = active?.status ? INTENT_STATUS[active.status] : null;
  const busy = starting || cancelling;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title="Wallet" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <View className="gap-4 px-5 pt-3">
            <View className="rounded-card bg-surface p-5" style={[CARD_SHADOW, { borderCurve: 'continuous' }]}>
              <Text className="text-meta font-semibold text-muted">Available balance</Text>
              {balance === undefined ? <Spinner className="mt-2 self-start" size={18} />
                : <Fare amount={balance} size="lg" tone="accent" className="mt-1" />}
              {balance === null ? <Text className="mt-1 text-body text-deal">Balance unavailable right now.</Text> : null}
              <Text className="mt-2 text-meta text-muted">Seat payments are taken from this balance when you confirm a booking.</Text>
              {summaryError ? <Text accessibilityLiveRegion="polite" className="mt-2 text-body text-deal">{summaryError}</Text> : null}
            </View>

            {/* Add funds */}
            <View className="gap-3 rounded-card bg-surface p-5" style={[CARD_SHADOW, { borderCurve: 'continuous' }]}>
              <Text accessibilityRole="header" className="text-title font-bold text-fg">Add funds</Text>
              <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
                {QUICK_AMOUNTS.map((preset) => {
                  const selected = amount === preset;
                  return (
                    <PressableScale key={preset} accessibilityRole="radio" accessibilityLabel={`${preset} TND`} accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} onPress={() => { setAmount(preset); setAmountError(''); }} className="min-h-11 justify-center">
                      <Chip label={`${preset} TND`} selected={selected} />
                    </PressableScale>
                  );
                })}
              </View>
              <Field label="Amount (TND)" placeholder="e.g. 25" value={amount} onChangeText={(value) => { setAmount(value); setAmountError(''); }} error={amountError} editable={!busy} keyboardType="decimal-pad" inputMode="decimal" returnKeyType="done" onSubmitEditing={() => void startTopup()} />
              <Button title="Pay with Flouci" icon="card-outline" block loading={starting} disabled={cancelling} onPress={() => void startTopup()} />
              <Text className="text-meta text-muted">You pay on Flouci’s secure page. Your balance is credited only after Flouci confirms the payment.</Text>
              {topupError ? <Text accessibilityLiveRegion="polite" className="text-body text-deal">{topupError}</Text> : null}

              {active && status ? (
                <View className="gap-2 rounded-input border border-line p-4" accessibilityLiveRegion="polite">
                  <View className="flex-row items-center justify-between">
                    <Text className={`text-body font-bold ${status.tone}`}>{status.label}</Text>
                    <Text className="text-body font-semibold tabular-nums text-fg">{formatTnd(active.amount)}</Text>
                  </View>
                  <Text className="text-meta text-muted">{status.hint}</Text>
                  {active.status === 'PENDING' ? (
                    <View className="flex-row flex-wrap gap-2">
                      {paymentUrl ? <Button title="Open Flouci page" size="sm" variant="secondary" disabled={busy} onPress={() => void openPayment(paymentUrl)} /> : null}
                      <Button title="Check payment status" size="sm" variant="secondary" loading={checking} disabled={busy} onPress={() => void checkActive()} />
                      <Button title="Cancel payment" size="sm" variant="ghost" loading={cancelling} disabled={starting} onPress={() => void cancelActive()} />
                    </View>
                  ) : null}
                  {active.status === 'PENDING' && !paymentUrl ? <Text className="text-meta text-deal">Flouci did not return a payment page for this attempt. Cancel it and try again.</Text> : null}
                </View>
              ) : null}

              {intents.length ? (
                <View className="gap-2 border-t border-line pt-3">
                  <Text className="text-meta font-semibold text-muted">Recent payment attempts</Text>
                  {intents.map((intent) => {
                    const meta = intent.status ? INTENT_STATUS[intent.status] : null;
                    return (
                      <View key={intent.id} className="flex-row items-center justify-between">
                        <View>
                          <Text className={`text-body font-medium ${meta?.tone ?? 'text-fg'}`}>{meta?.label ?? 'Status unavailable'}</Text>
                          <Text className="text-meta text-faint">{formatDate(intent.created_at)}</Text>
                        </View>
                        <Text className="text-body font-semibold tabular-nums text-fg">{formatTnd(intent.amount)}</Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>

            {/* Offers */}
            <View className="gap-3 rounded-card bg-surface p-5" style={[CARD_SHADOW, { borderCurve: 'continuous' }]}>
              <Text accessibilityRole="header" className="text-title font-bold text-fg">Offers and rewards</Text>
              {rewards.map((award) => {
                const copy = rewardCopy(award);
                return (
                  <View key={award.id} className="flex-row gap-3">
                    <Icon name={award.kind === 'DRIVER_FUEL' ? 'speedometer-outline' : 'gift-outline'} size={20} className={award.status === 'ISSUED' ? 'text-accent' : 'text-faint'} />
                    <View className="flex-1">
                      <Text className="text-body font-semibold text-fg">{copy.title}</Text>
                      <Text className="text-meta text-muted">{copy.hint}</Text>
                    </View>
                  </View>
                );
              })}
              {vouchers.filter((voucher) => !rewards.some((award) => award.code === voucher.code)).map((voucher) => (
                <View key={voucher.id} className="flex-row gap-3">
                  <Icon name="pricetag-outline" size={20} className="text-accent" />
                  <View className="flex-1">
                    <Text className="text-body font-semibold text-fg">Voucher {voucher.code} · {formatTnd(voucher.amount)}</Text>
                    <Text className="text-meta text-muted">Applied automatically at your next booking payment.{voucher.expires_at ? ` Expires ${formatDate(voucher.expires_at)}.` : ''}</Text>
                  </View>
                </View>
              ))}
              {!rewards.length && !vouchers.length ? <Text className="text-body text-muted">No offers yet. Rewards you qualify for appear here.</Text> : null}
              {user.role === 'PASSENGER' ? (
                <View className="gap-2 border-t border-line pt-3">
                  <Field label="Promo code" placeholder="e.g. SUMMER10" value={code} onChangeText={(value) => { setCode(value); setCodeError(''); setCodeNotice(''); }} error={codeError} editable={!claiming} autoCapitalize="characters" autoCorrect={false} returnKeyType="done" onSubmitEditing={() => void claim()} />
                  <Button title="Add code" variant="secondary" loading={claiming} onPress={() => void claim()} />
                  {codeNotice ? <Text accessibilityLiveRegion="polite" className="text-body font-semibold text-accentStrong">{codeNotice}</Text> : null}
                </View>
              ) : null}
            </View>

            {/* Driver earnings */}
            {isDriver ? (
              <View className="gap-2 rounded-card bg-surface p-5" style={[CARD_SHADOW, { borderCurve: 'continuous' }]}>
                <Text accessibilityRole="header" className="text-title font-bold text-fg">Earnings</Text>
                {earnings ? (
                  <>
                    {[
                      ['Fares from passengers', earnings.gross_fares],
                      ['Platform fees', earnings.platform_fees],
                      ['Refunded after cancellations', earnings.refunded],
                    ].map(([label, value]) => (
                      <View key={label} className="flex-row justify-between">
                        <Text className="text-body text-muted">{label}</Text>
                        <Text className="text-body tabular-nums text-fg">{formatTnd(value)}</Text>
                      </View>
                    ))}
                    <View className="flex-row justify-between border-t border-line pt-2">
                      <Text className="text-body font-bold text-fg">Net earnings</Text>
                      <Text className="text-body font-bold tabular-nums text-accentStrong">{formatTnd(earnings.net_earnings)}</Text>
                    </View>
                    <Text className="text-meta text-muted">{earnings.paid_bookings} paid {earnings.paid_bookings === 1 ? 'booking' : 'bookings'} · {earnings.refunded_bookings} refunded. Net earnings are already in your balance.</Text>
                  </>
                ) : <Spinner className="self-start" size={18} />}
              </View>
            ) : null}

            {/* History */}
            <View className="gap-3 rounded-card bg-surface p-5" style={[CARD_SHADOW, { borderCurve: 'continuous' }]}>
              <Text accessibilityRole="header" className="text-title font-bold text-fg">History</Text>
              <View className="flex-row flex-wrap gap-2" accessibilityRole="tablist">
                {HISTORY_FILTERS.map((item, index) => (
                  <PressableScale key={item.label} accessibilityRole="tab" accessibilityLabel={`Show ${item.label.toLowerCase()}`} accessibilityState={{ selected: filter === index }} onPress={() => chooseFilter(index)} className="min-h-11 justify-center">
                    <Chip label={item.label} size="sm" selected={filter === index} />
                  </PressableScale>
                ))}
              </View>
              {historyLoading ? <View className="flex-row items-center gap-2 py-2"><Spinner /><Text className="text-body text-muted">Loading history…</Text></View> : null}
              {historyError ? (
                <View className="gap-2">
                  <Text accessibilityLiveRegion="polite" className="text-body text-deal">{historyError}</Text>
                  <Button title="Retry history" variant="secondary" size="sm" onPress={retryHistory} />
                </View>
              ) : null}
              {history && !historyLoading && !history.results.length ? (
                <Text className="text-body text-muted">{filter === 0 ? 'No wallet activity yet. Add funds to book your first seat.' : 'Nothing in this category yet.'}</Text>
              ) : null}
              {!historyLoading && history?.results.map((entry) => {
                const amountValue = Number(entry.amount);
                const row = (
                  <View className="flex-row items-center justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-body font-medium text-fg">{entryLabel(entry)}</Text>
                      <Text className="text-meta text-faint">{formatDate(entry.created_at)}{entry.booking ? ' · View booking' : ''}</Text>
                    </View>
                    <Text className={`text-body font-semibold tabular-nums ${amountValue < 0 ? 'text-deal' : 'text-accentStrong'}`}>{amountValue > 0 ? '+' : ''}{formatTnd(entry.amount)}</Text>
                  </View>
                );
                const booking = entry.booking;
                return booking ? (
                  <PressableScale key={entry.id} accessibilityRole="link" accessibilityLabel={`${entryLabel(entry)} ${formatTnd(entry.amount)}. View booking`} onPress={() => router.push(`/booking/${booking}`)} className="min-h-11 justify-center">
                    {row}
                  </PressableScale>
                ) : <View key={entry.id} className="min-h-11 justify-center">{row}</View>;
              })}
              {history && (history.previous || history.next) ? (
                <View className="flex-row flex-wrap items-center gap-2">
                  <Button title="Newer" size="sm" variant="secondary" disabled={!history.previous || historyLoading} onPress={() => goToPage(pageNumber - 1)} />
                  <Button title="Older" size="sm" variant="secondary" disabled={!history.next || historyLoading} onPress={() => goToPage(pageNumber + 1)} />
                  <Text className="text-meta text-muted">Page {pageNumber} · {history.count} entries</Text>
                </View>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
