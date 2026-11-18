import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, Field, InterestPicker, ScreenHeader, Skeleton } from '@/components';
import { CARD_SHADOW } from '@/lib/theme';
import { createCampaign, myBrand } from '@/services/brands';
import { useSession } from '@/store/session';

const MONEY = /^\d+(\.\d{1,3})?$/;

/** Create a campaign: the offer, its declared audience and its budget cap. */
export default function NewCampaignScreen() {
  const user = useSession((s) => s.user);
  const [brand, setBrand] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [discount, setDiscount] = useState('');
  const [budget, setBudget] = useState('');
  const [audience, setAudience] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    myBrand().then(setBrand).catch(() => setBrand(null));
  }, []);

  const submit = async () => {
    if (!brand) return;
    setError('');
    if (!name.trim()) {
      setError('Give the campaign a name.');
      return;
    }
    if (!MONEY.test(discount.trim())) {
      setError('The discount per seat must be a TND amount, e.g. 5.000');
      return;
    }
    if (!MONEY.test(budget.trim()) || Number(budget) <= 0) {
      setError('The budget must be a positive TND amount, e.g. 500.000');
      return;
    }
    setBusy(true);
    try {
      const campaign = await createCampaign({
        brand: brand.id,
        name: name.trim(),
        discount_per_seat: discount.trim(),
        budget: budget.trim(),
        audience_interests: audience,
        promotion_title: title.trim(),
        promotion_body: body.trim(),
      });
      router.replace(`/brand/${campaign.id}` as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the campaign.');
    } finally {
      setBusy(false);
    }
  };

  if (user?.role !== 'BRAND') {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="New campaign" />
        <EmptyState icon="briefcase-outline" title="Brand accounts only" actionLabel="Back" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  if (brand === undefined) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="New campaign" />
        <View className="mt-4 gap-4 px-5">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
        </View>
      </SafeAreaView>
    );
  }

  if (brand === null) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="New campaign" />
        <EmptyState
          icon="briefcase-outline"
          title="No brand linked"
          message="Ask the Blasa team to link a brand to this account before creating campaigns."
          actionLabel="Back"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title="New campaign" />
      <ScrollView contentContainerClassName="gap-4 px-5 pb-8 pt-3" keyboardShouldPersistTaps="handled">
        <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="gap-3 rounded-card bg-surface p-4">
          <Text className="font-semibold text-title text-fg">{brand.name}</Text>
          <Field label="Campaign name" value={name} onChangeText={setName} placeholder="e.g. Spring commutes" editable={!busy} />
          <Field
            label="Discount per seat (TND)"
            icon="cash-outline"
            keyboardType="decimal-pad"
            value={discount}
            onChangeText={setDiscount}
            placeholder="5.000"
            editable={!busy}
          />
          <Field
            label="Budget cap (TND)"
            icon="wallet-outline"
            keyboardType="decimal-pad"
            value={budget}
            onChangeText={setBudget}
            placeholder="500.000"
            editable={!busy}
          />
          <Text className="text-meta text-muted">
            The budget is a cap, not a balance: discounts only pay out once the campaign is funded through the
            payment provider.
          </Text>
        </View>

        <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="gap-3 rounded-card bg-surface p-4">
          <Text className="font-semibold text-title text-fg">Audience</Text>
          <Text className="text-meta text-muted">
            Pick interest tags to target this offer. Leave empty to reach every member. Brands never see which
            members picked which interest.
          </Text>
          <InterestPicker selected={audience} onChange={setAudience} disabled={busy} />
        </View>

        <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="gap-3 rounded-card bg-surface p-4">
          <Text className="font-semibold text-title text-fg">Sponsored content</Text>
          <Text className="text-meta text-muted">Shown with the discount, always labelled “Sponsored”.</Text>
          <Field label="Headline" value={title} onChangeText={setTitle} placeholder="e.g. Powered by Aerialo" maxLength={120} editable={!busy} />
          <Field
            label="Short line"
            value={body}
            onChangeText={setBody}
            placeholder="e.g. A calmer commute, on us."
            maxLength={300}
            editable={!busy}
          />
        </View>

        {error ? <Text accessibilityRole="alert" className="text-body text-deal">{error}</Text> : null}
        <Button title="Create campaign" icon="checkmark-circle-outline" loading={busy} onPress={() => void submit()} block />
      </ScrollView>
    </SafeAreaView>
  );
}
