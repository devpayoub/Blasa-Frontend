import { router, useLocalSearchParams } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, EmptyState, Field, ScreenHeader, Skeleton } from '@/components';
import { formatTnd } from '@/lib/money';
import { CARD_SHADOW } from '@/lib/theme';
import {
  campaignAnalytics,
  getCampaign,
  issuePromoCode,
  listPromoCodes,
  listSponsoredRides,
  pauseCampaign,
  resumeCampaign,
  sponsorRide,
  startCampaignFunding,
  unsponsorRide,
} from '@/services/brands';
import type { Campaign, CampaignAnalytics, PromoCode, SponsoredRide } from '@/types';

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="gap-3 rounded-card bg-surface p-4">
      {children}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-[30%] flex-1 gap-0.5">
      <Text className="font-bold text-title text-fg">{value}</Text>
      <Text className="text-meta text-muted">{label}</Text>
    </View>
  );
}

/**
 * One campaign: offer, budget, payment-backed funding, sponsored rides, promo codes
 * and aggregate analytics. Every call is scoped to this brand by the backend.
 */
export default function CampaignDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null | undefined>(undefined);
  const [analytics, setAnalytics] = useState<CampaignAnalytics>();
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [rides, setRides] = useState<SponsoredRide[]>([]);
  const [fundAmount, setFundAmount] = useState('');
  const [codeAmount, setCodeAmount] = useState('');
  const [rideId, setRideId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    Promise.all([
      getCampaign(id).catch(() => null),
      campaignAnalytics(id).catch(() => undefined),
      listPromoCodes(id).catch(() => []),
      listSponsoredRides(id).catch(() => []),
    ]).then(([next, stats, promo, sponsored]) => {
      setCampaign(next);
      setAnalytics(stats);
      setCodes(promo);
      setRides(sponsored);
    });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const run = async (key: string, work: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(key);
    setError('');
    setMessage('');
    try {
      await work();
      if (done) setMessage(done);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That action did not complete.');
    } finally {
      setBusy('');
    }
  };

  if (campaign === undefined) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="Campaign" />
        <View className="mt-4 gap-3 px-5">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </View>
      </SafeAreaView>
    );
  }

  if (campaign === null) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="Campaign" />
        <EmptyState
          icon="megaphone-outline"
          title="Campaign unavailable"
          message="This campaign does not belong to your brand."
          actionLabel="Back to campaigns"
          onAction={() => router.replace('/brand' as never)}
        />
      </SafeAreaView>
    );
  }

  const remaining = Number(campaign.budget) - Number(campaign.spent);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title={campaign.name} />
      <ScrollView contentContainerClassName="gap-3 px-5 pb-8 pt-3" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Card>
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="font-bold text-h text-fg">{campaign.brand_name}</Text>
              <Text className="text-body text-muted">{`${formatTnd(campaign.discount_per_seat)} off per seat`}</Text>
            </View>
            <Badge label={campaign.is_active ? 'Active' : 'Paused'} tone={campaign.is_active ? 'accent' : 'soft'} />
          </View>
          <View className="flex-row flex-wrap gap-3 border-t border-line pt-3">
            <Metric label="Budget" value={formatTnd(campaign.budget)} />
            <Metric label="Spent" value={formatTnd(campaign.spent)} />
            <Metric label="Funded balance" value={formatTnd(campaign.balance)} />
          </View>
          {remaining <= 0 ? (
            <Text className="text-meta text-deal">The budget cap is reached; new discounts stop applying.</Text>
          ) : null}
          <View className="flex-row gap-2">
            {campaign.is_active ? (
              <Button
                className="flex-1"
                title="Pause"
                icon="pause-circle-outline"
                variant="secondary"
                size="sm"
                loading={busy === 'pause'}
                onPress={() => void run('pause', () => pauseCampaign(campaign.id), 'Campaign paused.')}
              />
            ) : (
              <Button
                className="flex-1"
                title="Resume"
                icon="play-circle-outline"
                size="sm"
                loading={busy === 'resume'}
                onPress={() => void run('resume', () => resumeCampaign(campaign.id), 'Campaign resumed.')}
              />
            )}
          </View>
        </Card>

        <Card>
          <Text className="font-semibold text-title text-fg">Funding</Text>
          <Text className="text-body text-muted">
            Discounts are paid from the campaign account. Fund it through the payment provider: nothing is
            credited from a receipt, a URL or a manual amount.
          </Text>
          <Field
            label="Amount to add (TND)"
            icon="card-outline"
            keyboardType="decimal-pad"
            value={fundAmount}
            onChangeText={setFundAmount}
            placeholder="100.000"
            editable={!busy}
          />
          <Button
            title="Fund with Flouci"
            icon="open-outline"
            variant="secondary"
            loading={busy === 'fund'}
            disabled={!campaign.is_active}
            onPress={() =>
              void run('fund', async () => {
                const result = await startCampaignFunding(campaign.id, fundAmount.trim());
                if (result.payment_url) await openBrowserAsync(result.payment_url);
                setFundAmount('');
                setMessage('Payment started. The balance updates once the provider confirms it.');
              })
            }
            block
          />
          {!campaign.is_active ? (
            <Text className="text-meta text-muted">Resume the campaign before funding it.</Text>
          ) : null}
        </Card>

        {analytics ? (
          <Card>
            <Text className="font-semibold text-title text-fg">Performance</Text>
            <View className="flex-row flex-wrap gap-3">
              <Metric label="Impressions" value={String(analytics.impressions)} />
              <Metric label="Offer opens" value={String(analytics.engagements)} />
              <Metric label="Redemptions" value={String(analytics.redemptions)} />
            </View>
            <View className="flex-row flex-wrap gap-3 border-t border-line pt-3">
              <Metric label="Subsidy paid" value={formatTnd(analytics.subsidy_spend)} />
              <Metric label="Promo redeemed" value={formatTnd(analytics.promo_redemption_value)} />
              <Metric label="Codes issued" value={String(analytics.promo_codes_issued)} />
            </View>
            <Text className="text-meta text-faint">
              Aggregates only. Blasa never shows brands which members saw or used an offer.
            </Text>
          </Card>
        ) : null}

        <Card>
          <Text className="font-semibold text-title text-fg">Sponsored rides</Text>
          {rides.length === 0 ? (
            <Text className="text-body text-muted">No rides sponsored yet. Paste a ride ID from a driver’s trip.</Text>
          ) : (
            rides.map((sponsorship) => (
              <View key={sponsorship.id} className="flex-row items-center justify-between gap-2 border-t border-line pt-2">
                <Text numberOfLines={1} className="flex-1 text-body text-fg">{sponsorship.ride_label}</Text>
                <Button
                  title="Remove"
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(busy)}
                  onPress={() =>
                    void run(`remove-${sponsorship.ride}`, () => unsponsorRide(campaign.id, sponsorship.ride), 'Ride removed.')
                  }
                />
              </View>
            ))
          )}
          <Field label="Ride ID" value={rideId} onChangeText={setRideId} placeholder="00000000-0000-0000-0000-000000000000" editable={!busy} />
          <Button
            title="Sponsor this ride"
            icon="add-circle-outline"
            variant="secondary"
            loading={busy === 'sponsor'}
            onPress={() =>
              void run('sponsor', async () => {
                await sponsorRide(campaign.id, rideId.trim());
                setRideId('');
              }, 'Ride sponsored. The discount applies at the passenger payment step.')
            }
            block
          />
        </Card>

        <Card>
          <Text className="font-semibold text-title text-fg">Promo codes</Text>
          <Text className="text-body text-muted">
            Single-use passenger codes. Issuing reserves budget; redeeming reports back to this campaign.
          </Text>
          <Field
            label="Code value (TND)"
            icon="pricetag-outline"
            keyboardType="decimal-pad"
            value={codeAmount}
            onChangeText={setCodeAmount}
            placeholder="5.000"
            editable={!busy}
          />
          <Button
            title="Issue a code"
            icon="pricetag-outline"
            variant="secondary"
            loading={busy === 'code'}
            onPress={() =>
              void run('code', async () => {
                await issuePromoCode(campaign.id, codeAmount.trim());
                setCodeAmount('');
              }, 'Code issued. Share it with the passengers you want to reach.')
            }
            block
          />
          {codes.map((code) => (
            <View key={code.id} className="flex-row items-center justify-between gap-2 border-t border-line pt-2">
              <View className="flex-1">
                <Text className="font-semibold text-body text-fg">{code.code}</Text>
                <Text className="text-meta text-muted">
                  {formatTnd(code.amount)} · {code.redeemed_at ? 'Redeemed' : 'Unused'}
                </Text>
              </View>
              <Badge label={code.redeemed_at ? 'Used' : 'Live'} tone={code.redeemed_at ? 'soft' : 'accent'} size="sm" />
            </View>
          ))}
        </Card>

        {error ? <Text accessibilityRole="alert" className="text-body text-deal">{error}</Text> : null}
        {message ? <Text accessibilityLiveRegion="polite" className="text-body text-accentStrong">{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
