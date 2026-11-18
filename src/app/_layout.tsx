import '../../global.css';

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startNotificationSession } from '@/lib/notifications';
import { captureException } from '@/lib/monitoring';
import { useSession } from '@/store/session';
import { AppBootSkeleton } from '@/components';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Replaces Expo Router's generic "Something went wrong" with the real error so
 * crashes are actionable. Self-contained (no providers) so it renders even when
 * the tree below failed.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    captureException(error, { source: 'error-boundary' });
  }, [error]);

  return (
    <View className="flex-1 bg-bg px-6 pt-24">
      <Text className="text-display font-bold text-fg">Something crashed</Text>
      <Text className="mt-2 text-body text-deal">
        {error?.name ? `${error.name}: ` : ''}
        {error?.message ?? 'Unknown error'}
      </Text>
      <ScrollView className="mt-4 max-h-80 rounded-card border border-line bg-surface p-3">
        <Text className="text-meta text-muted">{error?.stack ?? 'No stack available.'}</Text>
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void retry();
        }}
        className="mt-5 h-12 items-center justify-center rounded-pill bg-accent">
        <Text className="text-title font-bold text-onAccent">Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const sessionHydrated = useSession((s) => s.hydrated);
  const notificationOwner = useSession((s) => s.access ? s.user?.id : undefined);

  useEffect(() => {
    if (!sessionHydrated || !notificationOwner) return;
    return startNotificationSession(notificationOwner);
  }, [sessionHydrated, notificationOwner]);

  // Safety net: if the persisted session store ever fails to signal hydration
  // (seen on Android when secure storage rehydration errors), render anyway
  // after a beat instead of hanging on a blank screen forever.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);

  // Default to light mode — the cream canvas is the Blasa brand identity.
  // The dark palette stays defined; wire a settings toggle to enable it.
  useEffect(() => {
    setColorScheme('light');
  }, [setColorScheme]);

  const ready = (fontsLoaded && sessionHydrated) || timedOut;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return <AppBootSkeleton />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="start" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="ride/[id]" />
          <Stack.Screen name="ride/publish" />
          <Stack.Screen name="booking/[id]" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="interests" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="verification" />
          <Stack.Screen name="vehicles" />
          <Stack.Screen name="wallet" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="user/[id]" />
          <Stack.Screen name="report" />
          <Stack.Screen name="brand/index" />
          <Stack.Screen name="brand/new" />
          <Stack.Screen name="brand/[id]" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
