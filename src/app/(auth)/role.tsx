import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Icon, PressableScale, ScreenHeader, type IconName } from '@/components';
import { CARD_SHADOW } from '@/lib/theme';
import { useSession } from '@/store/session';

type Role = 'PASSENGER' | 'DRIVER';

const OPTIONS: { role: Role; title: string; body: string; icon: IconName; badge: string }[] = [
  {
    role: 'PASSENGER',
    title: 'I’m a passenger',
    body: 'Search trips, book a seat and share the ride. You can switch to driving later.',
    icon: 'people-outline',
    badge: 'Start booking',
  },
  {
    role: 'DRIVER',
    title: 'I’m a driver',
    body: 'Publish trips and earn per seat. Next step: upload your ID and vehicle papers.',
    icon: 'car-sport-outline',
    badge: 'Upload documents',
  },
];

/** Step 3 of 3: the role choice that decides where registration ends. */
export default function RoleScreen() {
  const router = useRouter();
  const pending = useSession((s) => s.pendingRegistration);
  const completeRegistration = useSession((s) => s.completeRegistration);
  const authPending = useSession((s) => s.authPending);
  const authError = useSession((s) => s.authError);
  const [role, setRole] = useState<Role>('PASSENGER');
  // Keep the credentials across the successful submit, which clears the store
  // value before navigation finishes. A remount without them still redirects.
  const [draft] = useState(() => pending);

  if (!draft) return <Redirect href="/(auth)/details" />;

  const submit = async () => {
    const ok = await completeRegistration({ ...draft, role });
    if (!ok) return;
    router.replace(role === 'DRIVER' ? '/verification?onboarding=1' : '/(tabs)');
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title="Choose your role" />
      <ScrollView contentContainerClassName="px-5 pb-8 pt-2">
        <View className="mb-6 flex-row items-center gap-2">
          {[1, 2, 3].map((step) => (
            <View key={step} className="h-1.5 flex-1 rounded-pill bg-accent" />
          ))}
        </View>

        <Text className="text-h font-bold text-fg">How will you use Blasa?</Text>
        <Text className="mt-1 text-body text-muted">
          This sets up your home screen. You can add driver mode later from Account.
        </Text>

        <View className="mt-6 gap-3">
          {OPTIONS.map((option) => {
            const selected = role === option.role;
            return (
              <PressableScale
                key={option.role}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setRole(option.role)}
                style={CARD_SHADOW}
                className={`rounded-card border-2 bg-surface p-4 ${selected ? 'border-accent' : 'border-transparent'}`}>
                <View className="flex-row items-center gap-3">
                  <View
                    className={`h-11 w-11 items-center justify-center rounded-pill ${
                      selected ? 'bg-accent' : 'bg-accentSoft'
                    }`}>
                    <Icon name={option.icon} size={22} className={selected ? 'text-onAccent' : 'text-accentStrong'} />
                  </View>
                  <View className="flex-1">
                    <Text className="font-bold text-title text-fg">{option.title}</Text>
                    <Text className="mt-0.5 text-meta text-muted">{option.body}</Text>
                  </View>
                  <Icon
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    className={selected ? 'text-accent' : 'text-faint'}
                  />
                </View>
              </PressableScale>
            );
          })}
        </View>

        {authError ? (
          <Text accessibilityRole="alert" className="mt-4 text-center text-meta text-deal">{authError}</Text>
        ) : null}

        <Button
          title={role === 'DRIVER' ? 'Continue to documents' : 'Start booking'}
          icon={role === 'DRIVER' ? 'cloud-upload-outline' : 'arrow-forward-outline'}
          loading={authPending}
          onPress={() => void submit()}
          block
          className="mt-6"
        />

        <Text className="mt-4 text-center text-meta text-faint">
          Driver mode activates after staff approve your ID and vehicle documents.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
