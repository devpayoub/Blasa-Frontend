import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="phone" />
      <Stack.Screen name="verify" />
      <Stack.Screen name="details" />
      <Stack.Screen name="role" />
    </Stack>
  );
}
