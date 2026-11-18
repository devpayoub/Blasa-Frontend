import { request } from '@/api/client';
import { toGeoPoint, type GeoPoint } from '@/lib/geo';
import type { Atmosphere, Page, Ride, RideCancellationQuote } from '@/types';

export interface PublishRideInput {
  origin: { lat: number; lng: number };
  origin_label: string;
  destination: { lat: number; lng: number };
  destination_label: string;
  departure_at: string; // ISO 8601
  seats_total: number;
  price_per_seat: string;
  vehicle: string; // vehicle id
  notes?: string;
  atmosphere?: Atmosphere | '';
  preferred_interests?: string[];
}

/** POST /api/v1/rides/ */
export function publishRide(input: PublishRideInput): Promise<Ride> {
  return request('/api/v1/rides/', {
    method: 'POST',
    auth: true,
    body: {
      origin: toGeoPoint(input.origin.lat, input.origin.lng) as unknown as GeoPoint,
      destination: toGeoPoint(input.destination.lat, input.destination.lng) as unknown as GeoPoint,
      origin_label: input.origin_label,
      destination_label: input.destination_label,
      departure_at: input.departure_at,
      seats_total: input.seats_total,
      price_per_seat: input.price_per_seat,
      vehicle: input.vehicle,
      notes: input.notes ?? '',
      atmosphere: input.atmosphere ?? '',
      preferred_interests: input.preferred_interests ?? [],
    },
  });
}

/** bookable: open upcoming rides · mine: rides I drive · joined: rides I booked. */
export type RideScope = 'bookable' | 'mine' | 'joined';

/** Schedule buckets for the owner/participant scopes. */
export type RideWhen = 'upcoming' | 'active' | 'completed' | 'cancelled';

export type RideOrdering = 'departure' | 'price' | 'pickup';

export interface RideSearch {
  from?: { lat: number; lng: number; radiusKm?: number };
  to?: { lat: number; lng: number; radiusKm?: number };
  departureAfter?: string; // ISO 8601
  departureBefore?: string;
  maxPrice?: string;
  minSeats?: number;
  ordering?: RideOrdering;
  /** Rides with this atmosphere or none set. */
  atmosphere?: Atmosphere;
  /** Only drivers sharing at least one of my profile interests. */
  sharedInterests?: boolean;
}

export interface ListRidesParams extends RideSearch {
  scope?: RideScope;
  when?: RideWhen;
  page?: number;
}

/** Query string for GET /api/v1/rides/; only set values are sent. */
export function rideQuery(params: ListRidesParams = {}): string {
  const q = new URLSearchParams();
  if (params.scope && params.scope !== 'bookable') q.set('scope', params.scope);
  if (params.when) q.set('when', params.when);
  for (const [prefix, point] of [['from', params.from], ['to', params.to]] as const) {
    if (!point) continue;
    q.set(`${prefix}_lat`, point.lat.toFixed(5));
    q.set(`${prefix}_lng`, point.lng.toFixed(5));
    if (point.radiusKm) q.set(`${prefix}_radius_km`, String(point.radiusKm));
  }
  if (params.departureAfter) q.set('departure_after', params.departureAfter);
  if (params.departureBefore) q.set('departure_before', params.departureBefore);
  if (params.maxPrice) q.set('max_price', params.maxPrice);
  if (params.minSeats && params.minSeats > 1) q.set('min_seats', String(params.minSeats));
  if (params.ordering && params.ordering !== 'departure') q.set('ordering', params.ordering);
  if (params.atmosphere) q.set('atmosphere', params.atmosphere);
  if (params.sharedInterests) q.set('shared_interests', 'true');
  if (params.page && params.page > 1) q.set('page', String(params.page));
  const text = q.toString();
  return text ? `?${text}` : '';
}

/** GET /api/v1/rides/?scope=…&from_lat=…  — both endpoints must match when given. */
export function listRides(params: ListRidesParams = {}): Promise<Page<Ride>> {
  return request(`/api/v1/rides/${rideQuery(params)}`, { method: 'GET', auth: true });
}

/** GET /api/v1/rides/{id}/ */
export function getRide(id: string): Promise<Ride> {
  return request(`/api/v1/rides/${id}/`, { method: 'GET', auth: true });
}

export type RideUpdate = Partial<Pick<Ride, 'departure_at' | 'seats_total' | 'price_per_seat' | 'notes' | 'atmosphere' | 'preferred_interests'>>;

/** PATCH /api/v1/rides/{id}/ — booked route, time and price are frozen server-side. */
export function updateRide(id: string, patch: RideUpdate): Promise<Ride> {
  return request(`/api/v1/rides/${id}/`, { method: 'PATCH', auth: true, body: patch });
}

/** POST /api/v1/rides/{id}/start/ */
export function startRide(id: string): Promise<Ride> {
  return request(`/api/v1/rides/${id}/start/`, { method: 'POST', auth: true });
}

/** POST /api/v1/rides/{id}/complete/ — completes every confirmed booking. */
export function completeRide(id: string): Promise<Ride> {
  return request(`/api/v1/rides/${id}/complete/`, { method: 'POST', auth: true });
}

/** GET /api/v1/rides/{id}/cancellation-quote/ — what cancelling would refund. */
export function rideCancellationQuote(id: string): Promise<RideCancellationQuote> {
  return request(`/api/v1/rides/${id}/cancellation-quote/`, { method: 'GET', auth: true });
}

/** POST /api/v1/rides/{id}/cancel/ — cancels every active booking and refunds paid ones. */
export function cancelRide(id: string): Promise<Ride> {
  return request(`/api/v1/rides/${id}/cancel/`, { method: 'POST', auth: true });
}

/** GET /api/v1/rides/near/?lat=..&lng=..&radius_km=.. */
export function ridesNear(lat: number, lng: number, radius_km = 5): Promise<Page<Ride>> {
  return request(`/api/v1/rides/near/?lat=${lat}&lng=${lng}&radius_km=${radius_km}`, {
    method: 'GET',
    auth: true,
  });
}
