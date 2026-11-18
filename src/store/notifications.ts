import { create } from 'zustand';

import { notificationPreferences, notificationUnreadCount, type NotificationPreferences } from '@/services/wallet';

interface NotificationsState {
  owner?: string;
  epoch: number;
  unread: number;
  countError?: string;
  preferences?: NotificationPreferences;
  preferencesBusy: boolean;
  preferencesError?: string;
  pushMessage?: string;
  setOwner: (owner?: string) => void;
  refreshUnread: (owner: string) => Promise<void>;
  loadPreferences: (owner: string) => Promise<NotificationPreferences | undefined>;
  setPreferences: (owner: string, preferences: NotificationPreferences) => void;
  setPreferencesBusy: (owner: string, busy: boolean) => void;
  setPushMessage: (owner: string, message?: string) => void;
}

// Never persist inbox/count/preferences. Guard responses across logout and same-user re-login.
let revision = 0;
let preferencesRequest = 0;
let preferencesPending: { request: number; promise: Promise<NotificationPreferences | undefined> } | undefined;
let countPending: { revision: number; promise: Promise<void> } | undefined;

export const useNotifications = create<NotificationsState>((set, get) => ({
  epoch: 0,
  unread: 0,
  preferencesBusy: false,
  setOwner: (owner) => {
    if (get().owner === owner) return;
    revision += 1;
    preferencesRequest += 1;
    countPending = undefined;
    set({ owner, epoch: revision, unread: 0, countError: undefined, preferences: undefined, preferencesBusy: false, preferencesError: undefined, pushMessage: undefined });
  },
  refreshUnread: async (owner) => {
    if (get().owner !== owner) return;
    if (countPending?.revision === revision) return countPending.promise;
    const version = revision;
    const promise = (async () => {
      try {
        const { count } = await notificationUnreadCount();
        if (get().owner === owner && revision === version) set({ unread: Math.max(0, count), countError: undefined });
      } catch {
        if (get().owner === owner && revision === version) set({ countError: 'Unread count unavailable. Open the inbox to retry.' });
      } finally {
        if (countPending?.revision === version) countPending = undefined;
      }
    })();
    countPending = { revision: version, promise };
    return promise;
  },
  loadPreferences: async (owner) => {
    const version = revision;
    if (get().owner !== owner || get().preferencesBusy) return undefined;
    if (preferencesPending?.request === preferencesRequest) return preferencesPending.promise;
    const request = ++preferencesRequest;
    const promise = (async () => {
      try {
        const preferences = await notificationPreferences();
        if (get().owner !== owner || version !== revision || request !== preferencesRequest) return undefined;
        set({ preferences, preferencesError: undefined });
        return preferences;
      } catch {
        if (get().owner === owner && version === revision && request === preferencesRequest) set({ preferencesError: 'Could not load notification preferences. Please retry.' });
        return undefined;
      } finally {
        if (preferencesPending?.request === request) preferencesPending = undefined;
      }
    })();
    preferencesPending = { request, promise };
    return promise;
  },
  setPreferences: (owner, preferences) => {
    if (get().owner === owner) {
      preferencesRequest += 1;
      set({ preferences, preferencesError: undefined });
    }
  },
  setPreferencesBusy: (owner, preferencesBusy) => {
    if (get().owner === owner) {
      if (preferencesBusy) preferencesRequest += 1;
      set({ preferencesBusy });
    }
  },
  setPushMessage: (owner, pushMessage) => {
    if (get().owner === owner) set({ pushMessage });
  },
}));
