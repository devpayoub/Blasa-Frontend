import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Field, ScreenHeader } from '@/components';
import { CARD_SHADOW } from '@/lib/theme';
import { fileReport } from '@/services/moderation';
import { REPORT_REASONS, type ReportTargetType } from '@/types';

const TARGET_COPY: Record<ReportTargetType, { title: string; hint: string }> = {
  USER: { title: 'Report this member', hint: 'Staff review every report. The member is not told who reported them.' },
  RIDE: { title: 'Report this ride', hint: 'Describe what went wrong on the trip. Staff can also refund and cancel rides.' },
  VEHICLE: { title: 'Report this vehicle', hint: 'Tell staff what was unsafe or misleading about the vehicle.' },
  MESSAGE: { title: 'Report this message', hint: 'Include what was said. Staff can read the conversation you are part of.' },
};

/**
 * File a report against a member, ride, vehicle or message.
 * The backend re-checks that the target exists and that you took part in it.
 */
export default function ReportScreen() {
  const params = useLocalSearchParams<{ type?: string; id?: string; label?: string }>();
  const type = (['USER', 'RIDE', 'VEHICLE', 'MESSAGE'].includes(params.type ?? '') ? params.type : 'USER') as ReportTargetType;
  const targetId = params.id ?? '';
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]['value'] | undefined>(undefined);
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const submit = async () => {
    if (sending.current) return;
    if (!reason) {
      setError('Choose what this report is about.');
      return;
    }
    if (!targetId) {
      setError('This report has no target. Open it from the ride, booking or message it concerns.');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await fileReport({ target_type: type, target_id: targetId, reason, details: details.trim() || undefined });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send this report. Please retry.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const copy = TARGET_COPY[type];

  if (sent) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="Report sent" />
        <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="mx-5 mt-4 gap-3 rounded-card bg-surface p-4">
          <Text className="font-bold text-h text-fg">Thanks — staff have it</Text>
          <Text className="text-body text-muted">
            We recorded your report and will review it. You can keep using Blasa normally; if the member is
            restricted, they will not be able to message you.
          </Text>
          <Button title="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title={copy.title} />
      <ScrollView contentContainerClassName="gap-4 px-5 pb-8 pt-3" keyboardShouldPersistTaps="handled">
        <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="gap-3 rounded-card bg-surface p-4">
          {params.label ? <Text className="text-meta text-muted">{params.label}</Text> : null}
          <Text className="text-body text-muted">{copy.hint}</Text>

          <Text className="font-semibold text-meta text-muted">What happened?</Text>
          <View className="flex-row flex-wrap gap-2">
            {REPORT_REASONS.map((option) => (
              <Button
                key={option.value}
                title={option.label}
                variant={reason === option.value ? 'primary' : 'secondary'}
                size="sm"
                accessibilityState={{ selected: reason === option.value }}
                disabled={busy}
                onPress={() => { setReason(option.value); setError(''); }}
              />
            ))}
          </View>

          <Field
            label="Details (optional)"
            value={details}
            onChangeText={setDetails}
            placeholder="What should staff know?"
            multiline
            numberOfLines={4}
            maxLength={2000}
            style={{ minHeight: 96, textAlignVertical: 'top' }}
            editable={!busy}
          />
          <Text className="text-meta text-faint">{details.length}/2000</Text>

          {error ? <Text accessibilityRole="alert" className="text-body text-deal">{error}</Text> : null}
          <Button title="Send report" icon="flag-outline" loading={busy} disabled={!reason} onPress={() => void submit()} block />
          <Text className="text-meta text-muted">
            Reports are private. Only staff see them, and they never include your password, codes or payment details.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
