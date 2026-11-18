import { Redirect, Tabs } from 'expo-router';

import { TabBar } from '@/components';
import { useSession } from '@/store/session';

export default function TabsLayout() {
  const user = useSession((s) => s.user);
  if (!user) return <Redirect href="/(auth)/phone" />;
  if (!user.profile?.full_name?.trim()) return <Redirect href="/(auth)/details" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // The custom TabBar floats above content — make the default
        // container invisible so only our floating bar shows.
        tabBarStyle: { display: 'none' },
        // Let content scroll under the floating bar
        tabBarBackground: () => null,
      }}
      // expo-router passes BottomTabBarProps directly; TabBar's props
      // interface matches the same shape so no cast is needed.
      tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="rides" options={{ title: 'Rides' }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings' }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
