import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, EmptyState, PressableScale, ScreenHeader, SkeletonRow } from '@/components';
import { formatTnd } from '@/lib/money';
import { CARD_SHADOW } from '@/lib/theme';
import { listCampaigns, myBrand } from '@/services/brands';
import { useSession } from '@/store/session';
import type { Campaign } from '@/types';

/**
 * Brand portal: the campaigns this brand owns. Ownership is enforced server-side,
 * so this screen can only ever list the caller's own brand.
 */
export default function BrandCampaignsScreen() {
  const user = useSession((s) => s.user);
  const [brand, setBrand] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [campaigns, setCampaigns] = useState<Campaign[] | undefined>(undefined);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([myBrand().catch(() => null), listCampaigns()])
      .then(([linked, page]) => {
        setBrand(linked);
        setCampaigns(page.results);
        setError('');
      })
      .catch((err) => {
        setCampaigns([]);
        setError(err instanceof Error ? err.message : 'Could not load your campaigns.');
      });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (user?.role !== 'BRAND') {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="Brand portal" />
        <EmptyState
          icon="briefcase-outline"
          title="Brand accounts only"
          message="A brand account is created by the Blasa team. Passenger and driver accounts keep their usual screens."
          actionLabel="Back"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title={brand ? brand.name : 'Brand portal'} />
      <ScrollView contentContainerClassName="gap-3 px-5 pb-8 pt-3" showsVerticalScrollIndicator={false}>
        {brand === undefined || campaigns === undefined ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : null}

        {brand === null ? (
          <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="gap-2 rounded-card bg-surface p-4">
            <Text className="font-semibold text-title text-fg">No brand linked yet</Text>
            <Text className="text-body text-muted">
              Your account is a brand account, but no brand is attached to it. Contact the Blasa team to be
              linked before creating campaigns.
            </Text>
          </View>
        ) : null}

        {error ? <Text accessibilityRole="alert" className="text-body text-deal">{error}</Text> : null}

        {campaigns?.length === 0 && !error ? (
          <EmptyState
            icon="megaphone-outline"
            title="No campaigns yet"
            message="Create a campaign to sponsor passenger fares on selected rides."
            actionLabel={brand ? 'Create a campaign' : undefined}
            onAction={brand ? () => router.push('/brand/new' as never) : undefined}
          />
        ) : null}

        {campaigns?.map((campaign) => (
          <PressableScale
            key={campaign.id}
            accessibilityRole="button"
            accessibilityLabel={`Open campaign ${campaign.name}`}
            onPress={() => router.push(`/brand/${campaign.id}` as never)}
            style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
            className="gap-2 rounded-card bg-surface p-4">
            <View className="flex-row items-start justify-between gap-2">
              <Text numberOfLines={2} className="flex-1 font-semibold text-title text-fg">{campaign.name}</Text>
              <Badge
                label={campaign.is_active ? 'Active' : 'Paused'}
                tone={campaign.is_active ? 'accent' : 'soft'}
                size="sm"
              />
            </View>
            <Text className="text-meta text-muted">
              {formatTnd(campaign.discount_per_seat)} off per seat · budget {formatTnd(campaign.budget)}
            </Text>
            <Text className="text-meta text-muted">
              Spent {formatTnd(campaign.spent)} · funded balance {formatTnd(String(campaign.balance))}
            </Text>
            {campaign.audience_interests?.length ? (
              <Text className="text-meta text-accentStrong">
                {`Targeted: ${campaign.audience_interests.join(', ')}`}
              </Text>
            ) : (
              <Text className="text-meta text-faint">Audience: every member</Text>
            )}
          </PressableScale>
        ))}

        {brand ? (
          <Button title="Create a campaign" icon="add-circle-outline" onPress={() => router.push('/brand/new' as never)} block />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
