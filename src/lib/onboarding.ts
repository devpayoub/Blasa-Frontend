import type { AuthUser } from '@/types';

/** A member has finished the minimum profile once a full name exists. */
export function hasProfile(user?: AuthUser | null): boolean {
  return Boolean(user?.profile?.full_name?.trim());
}

/**
 * Where to send someone immediately after authentication.
 *
 * Brand accounts go straight to their portal; everyone else lands on the
 * passenger/driver choice, or on the details step if the OTP account still has
 * no name.
 */
export function nextAuthRoute(user?: AuthUser | null): string {
  if (!user) return '/(auth)/phone';
  if (user.role === 'BRAND') return '/brand';
  if (!hasProfile(user)) return '/(auth)/details';
  return '/start';
}
