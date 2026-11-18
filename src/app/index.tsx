import { Redirect } from 'expo-router';

import { nextAuthRoute } from '@/lib/onboarding';
import { useIsAuthed, useSession } from '@/store/session';

/**
 * Entry router. Unauthenticated → login/verify; authenticated but undecided →
 * the passenger/driver choice; decided → tabs.
 */
export default function Index() {
  const isAuthed = useIsAuthed();
  const user = useSession((s) => s.user);
  const pending = useSession((s) => s.pendingContact);
  const entry = useSession((s) => s.entryChoice);

  if (!isAuthed) return <Redirect href={pending ? '/(auth)/verify' : '/(auth)/phone'} />;
  if (user?.role === 'BRAND') return <Redirect href={'/brand' as never} />;
  if (!entry) return <Redirect href={nextAuthRoute(user) as never} />;
  return <Redirect href="/(tabs)" />;
}
