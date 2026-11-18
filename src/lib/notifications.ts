import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import { AppState, Platform } from 'react-native';

import { persistentStorage } from '@/lib/secure-storage';
import { listNotifications, registerDevice, unregisterDevice, type NotificationPreferences } from '@/services/wallet';
import { useNotifications } from '@/store/notifications';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOKING_KINDS = new Set(['booking.created', 'booking.status_changed']);
const RIDE_KINDS = new Set(['ride.published', 'ride.cancelled', 'ride.reminder', 'match.found']);

/** Only locally constructed routes. Unknown kinds, malformed IDs and payload URLs are ignored. */
export function notificationLink(kind: string, raw: unknown): Href | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const payload = raw as Record<string, unknown>;
  const id = (key: string) => typeof payload[key] === 'string' && UUID.test(payload[key] as string) ? payload[key] as string : undefined;
  if (BOOKING_KINDS.has(kind)) {
    const booking = id('booking_id');
    return booking ? { pathname: '/booking/[id]', params: { id: booking } } : undefined;
  }
  if (RIDE_KINDS.has(kind)) {
    const ride = id('ride_id');
    return ride ? { pathname: '/ride/[id]', params: { id: ride } } : undefined;
  }
  if (kind === 'verification.changed' && id('document_id')) return '/verification';
  if (kind === 'payment.status_changed' && id('intent_id')) return '/wallet';
  if (kind === 'incentive.awarded' && id('award_id')) return '/wallet';
  // Wallet events identify a ledger entry by UUID; older entries have no local target.
  if (kind === 'wallet.posted' && (id('entry_id') || id('transaction_id'))) return '/wallet';
  return undefined;
}

export function notificationDate(value: unknown, language = 'en', dateOnly = false): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return undefined;
  const date = new Date(dateOnly && value.length === 10 ? `${value}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return undefined;
  try {
    return dateOnly ? date.toLocaleDateString(language) : date.toLocaleString(language);
  } catch {
    return dateOnly ? date.toLocaleDateString('en') : date.toLocaleString('en');
  }
}

const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

export function pushUnavailableMessage(preferences?: NotificationPreferences): string | undefined {
  if (Platform.OS === 'web') return 'Web push is unavailable. Your inbox is always on.';
  if (Constants.executionEnvironment === 'storeClient') return 'Remote push requires a physical device and a development build, not Expo Go.';
  if (!preferences) return 'Load preferences to check push availability.';
  const { expo, fcm } = preferences.capabilities;
  if (!expo && !fcm) return 'Push delivery is not configured on the server. Your inbox is always on.';
  if (expo && projectId) return undefined;
  if (fcm && Platform.OS === 'android') return undefined;
  if (Platform.OS === 'ios' && fcm && !expo) return 'FCM on iOS is unavailable in this build. Native iOS tokens are APNs, not FCM.';
  return 'Expo push requires a configured EAS project in a physical-device development build.';
}

type NativeNotifications = typeof import('expo-notifications');
interface DeviceAssociation { owner: string; token: string; platform: 'IOS' | 'ANDROID'; provider: 'EXPO' | 'FCM' }
const DEVICE_KEY = 'blasa.notification-device';
let device: DeviceAssociation | undefined;
let native: NativeNotifications | undefined;
let generation = 0;
let activeOwner: string | undefined;
let stopListeners: (() => void) | undefined;
let postingDevice: Promise<unknown> | undefined;
let registration: Promise<void> | undefined;

async function readDevice(): Promise<DeviceAssociation | undefined> {
  if (device) return device;
  const raw = await persistentStorage.getItem(DEVICE_KEY);
  if (!raw) return undefined;
  try {
    const saved = JSON.parse(raw) as DeviceAssociation;
    if (typeof saved.owner === 'string' && typeof saved.token === 'string' &&
      ['IOS', 'ANDROID'].includes(saved.platform) && ['EXPO', 'FCM'].includes(saved.provider)) device = saved;
  } catch { /* Invalid local association is not a registration. */ }
  return device;
}

function current(owner: string, version: number): boolean {
  return activeOwner === owner && generation === version && useNotifications.getState().owner === owner;
}

function granted(module: NativeNotifications, permission: Awaited<ReturnType<NativeNotifications['getPermissionsAsync']>>): boolean {
  return permission.granted || permission.ios?.status === module.IosAuthorizationStatus.PROVISIONAL;
}

/** A remote tap is resolved against the signed-in user's inbox, not trusted push data. */
async function ownedNotification(data: Record<string, unknown> | undefined, owner: string, version: number) {
  if (typeof data?.notification_id !== 'string' || !UUID.test(data.notification_id)) return undefined;
  for (let page = 1; page <= 3 && current(owner, version); page += 1) {
    const response = await listNotifications({ page });
    if (!current(owner, version)) return undefined;
    const match = response.results.find((item) => item.id === data.notification_id);
    if (match) return match;
    if (!response.next) break;
  }
  return undefined;
}

async function nativeModule(): Promise<NativeNotifications> {
  // Never execute/import the native push module on web or in Expo Go.
  native ??= await import('expo-notifications');
  return native;
}

function attachListeners(module: NativeNotifications, owner: string, version: number) {
  stopListeners?.();
  let lastTap: string | undefined;
  const navigate = async (response: Parameters<Parameters<NativeNotifications['addNotificationResponseReceivedListener']>[0]>[0]) => {
    if (!current(owner, version) || device?.owner !== owner) return;
    const tap = response.notification.request.identifier;
    if (tap === lastTap) return;
    lastTap = tap;
    try {
      await module.clearLastNotificationResponseAsync();
      const item = await ownedNotification(response.notification.request.content.data, owner, version);
      if (!current(owner, version)) return;
      // Older or foreign notifications may only open the current inbox, never their push payload.
      const target = item ? notificationLink(item.kind, item.payload) : undefined;
      router.push(target ?? '/notifications');
    } catch {
      if (current(owner, version)) {
        useNotifications.getState().setPushMessage(owner, 'Could not open this notification. Retry from your inbox.');
        router.push('/notifications');
      }
    }
  };
  // Foreground updates appear in the authenticated inbox/count, not unverified OS banners.
  // Expo requires a handler response within three seconds; never do network I/O here.
  module.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
  });
  const received = module.addNotificationReceivedListener(() => {
    if (current(owner, version)) void useNotifications.getState().refreshUnread(owner);
  });
  const tapped = module.addNotificationResponseReceivedListener((response) => { void navigate(response); });
  stopListeners = () => {
    received.remove();
    tapped.remove();
    module.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }) });
  };
  void module.getLastNotificationResponseAsync().then(async (response) => {
    if (!current(owner, version)) return;
    await module.clearLastNotificationResponseAsync();
    if (response) await navigate(response);
  }).catch(() => undefined);
}

/** requestPermission is true ONLY for the explicit opt-in action. */
export async function ensurePushRegistration(owner: string, preferences: NotificationPreferences, requestPermission: boolean): Promise<void> {
  if (registration) {
    try {
      await registration;
      if (device?.owner === owner && activeOwner === owner) return;
    } catch { /* A user-triggered retry may request permission after passive setup failed. */ }
  }
  const version = generation;
  const work = async () => {
    const unavailable = pushUnavailableMessage(preferences);
    if (unavailable) throw new Error(unavailable);
    const { isDevice } = await import('expo-device');
    if (!isDevice) throw new Error('Remote push requires a physical device and a development build. Your inbox remains available.');
    const module = await nativeModule();
    if (!current(owner, version)) throw new Error('Session changed. Please retry.');
    let permission = await module.getPermissionsAsync();
    if (Platform.OS === 'android' && (granted(module, permission) || requestPermission)) {
      await module.setNotificationChannelAsync('default', { name: 'Trip updates', importance: module.AndroidImportance.DEFAULT });
    }
    if (!granted(module, permission) && requestPermission) permission = await module.requestPermissionsAsync();
    if (!granted(module, permission)) throw new Error('Push permission is not granted. Enable it in device settings, then retry. Your inbox remains on.');
    const previous = await readDevice();
    if (previous && previous.owner !== owner) throw new Error('This device is still linked to another account. Reconnect and sign out of that account before enabling push here.');
    const provider = preferences.capabilities.expo && projectId ? 'EXPO' : 'FCM';
    const token = provider === 'EXPO'
      ? (await module.getExpoPushTokenAsync({ projectId })).data
      : (await module.getDevicePushTokenAsync()).data;
    if (typeof token !== 'string' || (provider === 'EXPO' && !/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/.test(token))) {
      throw new Error('Could not obtain a valid native push token. Please retry in a development build.');
    }
    if (!current(owner, version)) throw new Error('Session changed. Please retry.');
    if (previous && previous.token !== token) await unregisterDevice(previous.token);
    if (!current(owner, version)) throw new Error('Session changed. Please retry.');
    device = { owner, token, provider, platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID' };
    // Persist before posting: a timed-out registration may still have reached the server.
    const association = device;
    postingDevice = (async () => {
      await persistentStorage.setItem(DEVICE_KEY, JSON.stringify(association));
      if (!current(owner, version)) return;
      await registerDevice(token, association.platform, provider);
    })();
    try { await postingDevice; } finally { postingDevice = undefined; }
    if (!current(owner, version)) throw new Error('Session changed. Please retry.');
    attachListeners(module, owner, version);
    useNotifications.getState().setPushMessage(owner, 'This device is registered. Delivery depends on the configured transport and connectivity.');
  };
  registration = work();
  try { await registration; } finally { registration = undefined; }
}

export async function disableDevicePush(owner: string): Promise<void> {
  const version = generation;
  if (activeOwner && activeOwner !== owner) return;
  stopListeners?.();
  stopListeners = undefined;
  const saved = await readDevice();
  if (saved?.owner !== owner || generation !== version) return;
  await unregisterDevice(saved.token);
  if (device === saved && generation === version) {
    device = undefined;
    await persistentStorage.removeItem(DEVICE_KEY);
  }
}

/** Invalidate synchronously; unregister while the caller still holds its auth token. */
export async function cleanupNotificationSession(owner?: string): Promise<void> {
  generation += 1;
  activeOwner = undefined;
  stopListeners?.();
  stopListeners = undefined;
  useNotifications.getState().setOwner(undefined);
  if (Platform.OS === 'web') return;
  const version = generation;
  const cleanup = async () => {
    // Finish an already-started POST before DELETE so it cannot re-register after cleanup.
    await postingDevice?.catch(() => undefined);
    if (generation !== version) return;
    if (native) await native.clearLastNotificationResponseAsync().catch(() => undefined);
    if (owner && generation === version) await disableDevicePush(owner);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([cleanup().catch(() => undefined), new Promise<void>((resolve) => { timer = setTimeout(resolve, 3500); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Called once per signed-in owner; modest polling pauses when the app is inactive. */
export function startNotificationSession(owner: string): () => void {
  generation += 1;
  const version = generation;
  activeOwner = owner;
  useNotifications.getState().setOwner(owner);
  const refresh = () => {
    if (current(owner, version) && AppState.currentState === 'active') void useNotifications.getState().refreshUnread(owner);
  };
  refresh();
  void useNotifications.getState().loadPreferences(owner).then(async (preferences) => {
    if (!preferences?.push_enabled || !current(owner, version)) return;
    try { await ensurePushRegistration(owner, preferences, false); }
    catch (err) {
      if (current(owner, version)) useNotifications.getState().setPushMessage(owner, err instanceof Error ? err.message : 'Push registration unavailable. Retry from preferences.');
    }
  });
  const poll = setInterval(refresh, 60000);
  const appState = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
  return () => {
    clearInterval(poll);
    appState.remove();
    if (current(owner, version)) {
      generation += 1;
      activeOwner = undefined;
      stopListeners?.();
      stopListeners = undefined;
      useNotifications.getState().setOwner(undefined);
    }
  };
}
