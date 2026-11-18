import { request } from '@/api/client';
import type { Campaign, CampaignAnalytics, Page, PromoCode, SponsoredRide } from '@/types';

/** GET /api/v1/brands/brands/mine/ — the brand linked to this account. */
export function myBrand(): Promise<{ id: string; name: string; website: string; logo_key: string }> {
  return request('/api/v1/brands/brands/mine/', { method: 'GET', auth: true });
}

/** GET /api/v1/brands/campaigns/ — only this account's campaigns (server-scoped). */
export function listCampaigns(): Promise<Page<Campaign>> {
  return request('/api/v1/brands/campaigns/', { method: 'GET', auth: true });
}

export function getCampaign(id: string): Promise<Campaign> {
  return request(`/api/v1/brands/campaigns/${id}/`, { method: 'GET', auth: true });
}

export interface CampaignInput {
  brand: string;
  name: string;
  discount_per_seat: string;
  budget: string;
  starts_at?: string | null;
  ends_at?: string | null;
  audience_interests?: string[];
  promotion_title?: string;
  promotion_body?: string;
  promotion_url?: string;
}

export function createCampaign(input: CampaignInput): Promise<Campaign> {
  return request('/api/v1/brands/campaigns/', { method: 'POST', auth: true, body: input });
}

export function updateCampaign(id: string, patch: Partial<CampaignInput>): Promise<Campaign> {
  return request(`/api/v1/brands/campaigns/${id}/`, { method: 'PATCH', auth: true, body: patch });
}

export function pauseCampaign(id: string): Promise<Campaign> {
  return request(`/api/v1/brands/campaigns/${id}/pause/`, { method: 'POST', auth: true });
}

export function resumeCampaign(id: string): Promise<Campaign> {
  return request(`/api/v1/brands/campaigns/${id}/resume/`, { method: 'POST', auth: true });
}

export function campaignAnalytics(id: string): Promise<CampaignAnalytics> {
  return request(`/api/v1/brands/campaigns/${id}/analytics/`, { method: 'GET', auth: true });
}

/** Brand funding is payment-backed: it returns a provider URL, never a credit. */
export function startCampaignFunding(
  id: string,
  amount: string,
): Promise<{ intent: string; status: string; amount: string; payment_url?: string | null }> {
  return request(`/api/v1/brands/campaigns/${id}/funding-intents/`, {
    method: 'POST',
    auth: true,
    body: { amount },
  });
}

export function listSponsoredRides(id: string): Promise<SponsoredRide[]> {
  return request(`/api/v1/brands/campaigns/${id}/sponsored-rides/`, { method: 'GET', auth: true });
}

export function sponsorRide(id: string, ride: string): Promise<SponsoredRide> {
  return request(`/api/v1/brands/campaigns/${id}/sponsored-rides/`, {
    method: 'POST',
    auth: true,
    body: { ride },
  });
}

export function unsponsorRide(id: string, rideId: string): Promise<void> {
  return request(`/api/v1/brands/campaigns/${id}/sponsored-rides/${rideId}/`, { method: 'DELETE', auth: true });
}

export function listPromoCodes(id: string): Promise<PromoCode[]> {
  return request(`/api/v1/brands/campaigns/${id}/promo-codes/`, { method: 'GET', auth: true });
}

export function issuePromoCode(id: string, amount: string): Promise<PromoCode> {
  return request(`/api/v1/brands/campaigns/${id}/promo-codes/`, {
    method: 'POST',
    auth: true,
    body: { amount },
  });
}

/**
 * Passenger-side telemetry for a sponsored ride. Deduplicated server-side by
 * (campaign, ride, member, kind, day), so replaying cannot inflate the brand's
 * numbers. Redemptions are never client-reported — they come from the ledger.
 */
export function recordSponsorshipEvent(
  rideId: string,
  kind: 'IMPRESSION' | 'ENGAGEMENT',
): Promise<{ recorded: boolean }> {
  return request(`/api/v1/brands/sponsorship/${rideId}/events/`, {
    method: 'POST',
    auth: true,
    body: { kind },
  });
}
