import { request } from '@/api/client';
import { toGeoPoint } from '@/lib/geo';
import type { Interest, Page, ScoredInterest, ScoredRide } from '@/types';

export interface CreateInterestInput {
  origin: { lat: number; lng: number };
  origin_label: string;
  destination: { lat: number; lng: number };
  destination_label: string;
  earliest_departure: string; // ISO 8601
  latest_departure: string; // ISO 8601
  seats: number;
}

/** POST /api/v1/interests/ */
export function createInterest(input: CreateInterestInput): Promise<Interest> {
  return request('/api/v1/interests/', {
    method: 'POST',
    auth: true,
    body: {
      origin: toGeoPoint(input.origin.lat, input.origin.lng),
      destination: toGeoPoint(input.destination.lat, input.destination.lng),
      origin_label: input.origin_label,
      destination_label: input.destination_label,
      earliest_departure: input.earliest_departure,
      latest_departure: input.latest_departure,
      seats: input.seats,
    },
  });
}

/** GET /api/v1/interests/ */
export function listInterests(): Promise<Page<Interest>> {
  return request('/api/v1/interests/', { method: 'GET', auth: true });
}

/** DELETE /api/v1/interests/{id}/ */
export function deleteInterest(id: string): Promise<void> {
  return request(`/api/v1/interests/${id}/`, { method: 'DELETE', auth: true });
}

/** GET /api/v1/matching/interests/{id}/rides/ — first page, best score first. */
export async function matchingRidesForInterest(interestId: string): Promise<ScoredRide[]> {
  const page = await request<Page<ScoredRide>>(`/api/v1/matching/interests/${interestId}/rides/`, { method: 'GET', auth: true });
  return page.results;
}

/** GET /api/v1/matching/rides/{id}/interests/ — first page, best score first. */
export async function matchingInterestsForRide(rideId: string): Promise<ScoredInterest[]> {
  const page = await request<Page<ScoredInterest>>(`/api/v1/matching/rides/${rideId}/interests/`, { method: 'GET', auth: true });
  return page.results;
}

export type { ScoredRide, ScoredInterest };
