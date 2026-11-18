import { request } from '@/api/client';
import type { DriverEarnings, IncentiveAward, LedgerEntry, Notification, Page, PaymentIntent, TopupResult, Voucher } from '@/types';

/** GET /api/v1/wallet/me/ */
export function walletMe(): Promise<{ balance: string; currency: string }> {
  return request('/api/v1/wallet/me/', { method: 'GET', auth: true });
}

/** GET /api/v1/wallet/entries/ — paginated, newest first; `kinds` filters by transaction kind. */
export function ledgerEntries(options: { kinds?: string[]; page?: number } = {}): Promise<Page<LedgerEntry>> {
  const params = new URLSearchParams();
  if (options.kinds?.length) params.set('kind', options.kinds.join(','));
  if (options.page && options.page > 1) params.set('page', String(options.page));
  const query = params.toString();
  return request(`/api/v1/wallet/entries/${query ? `?${query}` : ''}`, { method: 'GET', auth: true });
}

/** GET /api/v1/wallet/earnings/ — drivers only; derived from the ledger. */
export function walletEarnings(): Promise<DriverEarnings> {
  return request('/api/v1/wallet/earnings/', { method: 'GET', auth: true });
}

/** POST /api/v1/payments/topup/ — starts an online topup; the wallet is credited only by the gateway's confirmation. */
export function createTopup(amount: string): Promise<TopupResult> {
  return request('/api/v1/payments/topup/', { method: 'POST', auth: true, body: { amount, gateway: 'FLOUCI' } });
}

/** GET /api/v1/payments/intents/ — the caller's payment attempts, newest first. */
export function listPaymentIntents(): Promise<Page<PaymentIntent>> {
  return request('/api/v1/payments/intents/', { method: 'GET', auth: true });
}

/** GET /api/v1/payments/intents/{id}/ */
export function getPaymentIntent(id: string): Promise<PaymentIntent> {
  return request(`/api/v1/payments/intents/${id}/`, { method: 'GET', auth: true });
}

/** POST /api/v1/payments/intents/{id}/cancel/ — only pending attempts. */
export function cancelPaymentIntent(id: string): Promise<PaymentIntent> {
  return request(`/api/v1/payments/intents/${id}/cancel/`, { method: 'POST', auth: true });
}

/** GET /api/v1/incentives/vouchers/ — the caller's unused, unexpired vouchers. */
export function listVouchers(): Promise<Page<Voucher>> {
  return request('/api/v1/incentives/vouchers/', { method: 'GET', auth: true });
}

/** POST /api/v1/incentives/vouchers/claim/ */
export function claimVoucher(code: string): Promise<Voucher> {
  return request('/api/v1/incentives/vouchers/claim/', { method: 'POST', auth: true, body: { code } });
}

/** GET /api/v1/incentives/rewards/ — welcome credit and fuel rewards. */
export function listRewards(): Promise<Page<IncentiveAward>> {
  return request('/api/v1/incentives/rewards/', { method: 'GET', auth: true });
}

/** GET /api/v1/notifications/ — never follow server pagination URLs directly. */
export function listNotifications(options: { page?: number; unread?: boolean } = {}): Promise<Page<Notification>> {
  const params = new URLSearchParams({ page: String(options.page ?? 1) });
  if (options.unread) params.set('unread', 'true');
  return request(`/api/v1/notifications/?${params}`, { method: 'GET', auth: true });
}

/** POST /api/v1/notifications/{id}/read/ */
export function markNotificationRead(id: string): Promise<Notification> {
  return request(`/api/v1/notifications/${encodeURIComponent(id)}/read/`, { method: 'POST', auth: true });
}

export function notificationUnreadCount(): Promise<{ count: number }> {
  return request('/api/v1/notifications/unread-count/', { method: 'GET', auth: true });
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return request('/api/v1/notifications/read-all/', { method: 'POST', auth: true });
}

/** Local contract until the shared OpenAPI schema includes preferences. */
export interface NotificationPreferences {
  push_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  promotions_enabled: boolean;
  capabilities: { expo: boolean; fcm: boolean; email: boolean; sms: boolean };
}

export type NotificationPreferencePatch = Partial<Omit<NotificationPreferences, 'capabilities'>>;

export function notificationPreferences(): Promise<NotificationPreferences> {
  return request('/api/v1/notifications/preferences/', { method: 'GET', auth: true });
}

export function updateNotificationPreferences(body: NotificationPreferencePatch): Promise<NotificationPreferences> {
  return request('/api/v1/notifications/preferences/', { method: 'PATCH', auth: true, body });
}

/** Registration is not a claim of delivery. Native iOS device tokens are APNs, not FCM. */
export function registerDevice(token: string, platform: 'IOS' | 'ANDROID' | 'WEB', provider: 'EXPO' | 'FCM'): Promise<{ token: string; platform: string; provider: string }> {
  return request('/api/v1/notifications/devices/', {
    method: 'POST', auth: true, body: { token, platform, provider }, timeoutMs: 1500, _retried: true,
  });
}

/** Bounded and without token refresh so cleanup cannot resurrect an expired session. */
export function unregisterDevice(token: string): Promise<void> {
  return request('/api/v1/notifications/devices/', {
    method: 'DELETE', auth: true, body: { token }, timeoutMs: 1500, _retried: true,
  });
}
