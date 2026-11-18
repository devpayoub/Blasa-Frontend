import { Redirect, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Icon, PressableScale, type IconName } from '@/components';
import { CARD_SHADOW } from '@/lib/theme';
import { useSession } from '@/store/session';

const OPTIONS: {
  key: 'PASSENGER' | 'DRIVER';
  title: string;
  body: string;
  cta: string;
  icon: IconName;
}[] = [
  {
    key: 'PASSENGER',
    title: 'Book a ride',
    body: 'Find a driver heading your way, reserve a seat and pay from your wallet.',
    cta: 'Browse rides',
    icon: 'search-outline',
  },
  {
    key: 'DRIVER',
    title: 'Drive & earn',
    body: 'Publish your trips. Upload your ID and vehicle papers to unlock driving.',
    cta: 'Continue to documents',
    icon: 'car-sport-outline',
  },
];

/**
 * The post-login choice. Passenger goes straight to the tabs; driver goes
 * through document upload (and only reaches the tabs once approved).
 */
export default function StartScreen() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const chooseEntry = useSession((s) => s.chooseEntry);

  if (!user) return <Redirect href="/(auth)/phone" />;
  if (user.role === 'BRAND') return <Redirect href={'/brand' as never} />;
  if (!user.profile?.full_name?.trim()) return <Redirect href="/(auth)/details" />;

  const pick = (choice: 'PASSENGER' | 'DRIVER') => {
    chooseEntry(choice);
    if (choice === 'PASSENGER') {
      router.replace('/(tabs)');
      return;
    }
    if (user.role === 'DRIVER' && user.is_verified) {
      router.replace('/(tabs)');
      return;
    }
    router.replace('/verification?onboarding=1');
  };

  const firstName = user.profile?.full_name?.split(' ')[0];

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-1 px-5 pb-6 pt-6">
        <View className="flex-row items-center gap-2.5">
          <View className="h-10 w-10 items-center justify-center rounded-pill bg-navy">
            <Icon name="car-sport" size={20} className="text-accent" />
          </View>
          <Text className="text-title font-bold text-fg">Blasa</Text>
        </View>

        <View className="mt-10">
          <Text className="text-display font-bold text-fg">
            {firstName ? `Welcome, ${firstName}` : 'Welcome'}
          </Text>
          <Text className="mt-2 text-body text-muted">
            How do you want to use Blasa today? You can switch anytime from Account.
          </Text>
        </View>

        <View className="mt-8 gap-3">
          {OPTIONS.map((option) => (
            <PressableScale
              key={option.key}
              accessibilityRole="button"
              accessibilityLabel={`${option.title}. ${option.cta}`}
              onPress={() => pick(option.key)}
              style={CARD_SHADOW}
              className="rounded-card bg-surface p-4">
              <View className="flex-row items-start gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-pill bg-accentSoft">
                  <Icon name={option.icon} size={22} className="text-accentStrong" />
                </View>
                <View className="flex-1">
                  <Text className="font-bold text-h text-fg">{option.title}</Text>
                  <Text className="mt-1 text-body text-muted">{option.body}</Text>
                  <View className="mt-3 flex-row items-center gap-1">
                    <Text className="font-semibold text-body text-accentStrong">{option.cta}</Text>
                    <Icon name="arrow-forward" size={16} className="text-accentStrong" />
                  </View>
                </View>
              </View>
            </PressableScale>
          ))}
        </View>

        <View className="flex-1" />

        <Button
          title="Sign out"
          variant="ghost"
          icon="log-out-outline"
          onPress={() => void useSession.getState().signOut()}
        />
      </View>
    </SafeAreaView>
  );
}
