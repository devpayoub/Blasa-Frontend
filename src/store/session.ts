import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { ApiError, setAuthToken, setAuthExpiredHandler, setRefreshHandler } from '@/api/client';
import { MOCK_ENABLED, syncMockRole } from '@/api/mock';
import { friendlyError } from '@/lib/errors';
import { cleanupNotificationSession } from '@/lib/notifications';
import { persistentStorage } from '@/lib/secure-storage';
import {
  completeRegistration as completeRegistrationApi,
  checkContact as checkContactApi,
  logout,
  passwordLogin,
  refreshToken,
  requestEmailOtp,
  requestOtp,
  verifyEmailOtp,
  verifyOtp,
  type ContactChannel,
  type ContactStatus,
} from '@/services/auth';
import { me as fetchMe } from '@/services/users';
import type { AuthUser } from '@/types';

/** How the member said they want to use Blasa after signing in. */
export type EntryChoice = 'PASSENGER' | 'DRIVER';

interface SessionState {
  hydrated: boolean;
  authPending: boolean;
  authError?: string;
  pendingContact?: { channel: ContactChannel; contact: string };
  /** In-memory only: name + password waiting for the role choice. Never persisted. */
  pendingRegistration?: { fullName: string; password: string };
  user?: AuthUser;
  access?: string;
  refresh?: string;
  entryChoice?: EntryChoice;

  requestLoginCode: (contact: string, channel: ContactChannel) => Promise<boolean>;
  verifyLoginCode: (code: string) => Promise<boolean>;
  checkContact: (contact: string) => Promise<ContactStatus>;
  loginWithPassword: (contact: string, password: string) => Promise<boolean>;
  setPendingRegistration: (input: { fullName: string; password: string }) => void;
  completeRegistration: (input: { fullName: string; password: string; role: 'PASSENGER' | 'DRIVER' }) => Promise<boolean>;
  chooseEntry: (choice: EntryChoice) => void;
  signOut: () => Promise<void>;
  clearAuthError: () => void;
  refreshMe: () => Promise<void>;
  setHydrated: () => void;
}

function errorMessage(err: unknown): string {
  return friendlyError(err);
}

let signingOut = false;

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      authPending: false,
      authError: undefined,
      pendingContact: undefined,
      pendingRegistration: undefined,
      user: undefined,
      access: undefined,
      refresh: undefined,
      entryChoice: undefined,

      requestLoginCode: async (contact, channel) => {
        if (get().authPending) return false;
        set({ authPending: true, authError: undefined });
        try {
          if (channel === 'EMAIL') await requestEmailOtp(contact);
          else await requestOtp(contact);
          await cleanupNotificationSession(get().user?.id);
          setAuthToken(undefined);
          set({
            user: undefined,
            access: undefined,
            refresh: undefined,
            authPending: false,
            pendingContact: { channel, contact },
            entryChoice: undefined,
          });
          return true;
        } catch (err) {
          set({ authPending: false, authError: errorMessage(err) });
          return false;
        }
      },

      verifyLoginCode: async (code) => {
        const pending = get().pendingContact;
        if (!pending) {
          set({ authError: 'No login request in progress.' });
          return false;
        }
        if (get().authPending) return false;
        set({ authPending: true, authError: undefined });
        try {
          if (!get().access) {
            const tokens = pending.channel === 'EMAIL'
              ? await verifyEmailOtp(pending.contact, code.trim())
              : await verifyOtp(pending.contact, code.trim());
            setAuthToken(tokens.access);
            set({ access: tokens.access, refresh: tokens.refresh });
          }
          const user = await fetchMe();
          if (MOCK_ENABLED) syncMockRole(user.role);
          set({ user, authPending: false, pendingContact: undefined, entryChoice: undefined });
          return true;
        } catch (err) {
          set({ authPending: false, authError: errorMessage(err) });
          return false;
        }
      },

      checkContact: (contact) => checkContactApi(contact),

      loginWithPassword: async (contact, password) => {
        if (get().authPending) return false;
        set({ authPending: true, authError: undefined });
        try {
          const tokens = await passwordLogin(contact, password);
          setAuthToken(tokens.access);
          set({ access: tokens.access, refresh: tokens.refresh });
          const user = await fetchMe();
          if (MOCK_ENABLED) syncMockRole(user.role);
          set({ user, authPending: false, pendingContact: undefined, entryChoice: undefined });
          return true;
        } catch (err) {
          setAuthToken(undefined);
          set({ access: undefined, refresh: undefined, authPending: false, authError: errorMessage(err) });
          return false;
        }
      },

      setPendingRegistration: ({ fullName, password }) => set({ pendingRegistration: { fullName, password } }),

      completeRegistration: async ({ fullName, password, role }) => {
        if (get().authPending) return false;
        set({ authPending: true, authError: undefined });
        try {
          const user = await completeRegistrationApi({ full_name: fullName.trim(), password, role });
          if (MOCK_ENABLED) syncMockRole(user.role);
          set({ user, authPending: false, entryChoice: undefined, pendingRegistration: undefined });
          return true;
        } catch (err) {
          set({ authPending: false, authError: errorMessage(err) });
          return false;
        }
      },

      chooseEntry: (choice) => set({ entryChoice: choice }),

      signOut: async () => {
        if (signingOut) return;
        signingOut = true;
        const refresh = get().refresh;
        set({ authPending: true });
        try {
          // Stop listeners and invalidate owner state now; DELETE still needs the current token.
          // Bounded best effort: offline cleanup never prevents local logout.
          await cleanupNotificationSession(get().user?.id);
        } finally {
          if (refresh) void logout(refresh).catch(() => undefined);
          setAuthToken(undefined);
          set({
            user: undefined,
            access: undefined,
            refresh: undefined,
            pendingContact: undefined,
            pendingRegistration: undefined,
            authError: undefined,
            authPending: false,
            entryChoice: undefined,
          });
          signingOut = false;
        }
      },

      clearAuthError: () => set({ authError: undefined }),

      refreshMe: async () => {
        const access = get().access;
        if (!access) return;
        try {
          const user = await fetchMe();
          // Mock mode: the fixture world follows the signed-in role.
          if (MOCK_ENABLED) syncMockRole(user.role);
          set({ user });
        } catch (err) {
          // The client's refresh handler already tried rotating the token; a
          // remaining failure here means the session is really gone. Network
          // errors keep the cached user so the app still opens offline.
          if (err instanceof ApiError && err.status === 401) get().signOut();
        }
      },

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'blasa.session',
      storage: createJSONStorage(() => persistentStorage),
      partialize: (s) => ({
        user: s.user,
        access: s.access,
        refresh: s.refresh,
        pendingContact: s.pendingContact,
        entryChoice: s.entryChoice,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.access) setAuthToken(state.access);
        state?.setHydrated();
        // Validate the cached session against the backend in the background.
        void state?.refreshMe();
      },
    },
  ),
);

// --- Wire the client's silent-refresh and expiry hooks to the session store.
setRefreshHandler(async () => {
  const refresh = useSession.getState().refresh;
  if (!refresh || signingOut) return false;
  try {
    const tokens = await refreshToken(refresh);
    if (signingOut || useSession.getState().refresh !== refresh) return false;
    setAuthToken(tokens.access);
    useSession.setState({ access: tokens.access, refresh: tokens.refresh });
    return true;
  } catch {
    return false;
  }
});

setAuthExpiredHandler(() => {
  useSession.getState().signOut();
});

export const useIsAuthed = () => useSession((s) => !!s.user && !!s.access);
export const useIsDriver = () => useSession((s) => s.user?.role === 'DRIVER');
