import { request } from '@/api/client';
import { toGeoPoint } from '@/lib/geo';
import type { Booking, BookingAction, CancellationQuote, Page, PaymentQuote } from '@/types';

export interface CreateBookingInput {
  ride: string;
  seats: number;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
}

/** POST /api/v1/bookings/ — fare is computed server-side from the ride. */
export function createBooking(input: CreateBookingInput): Promise<Booking> {
  return request('/api/v1/bookings/', {
    method: 'POST',
    auth: true,
    body: {
      ride: input.ride,
      seats: input.seats,
      pickup_point: toGeoPoint(input.pickup.lat, input.pickup.lng),
      dropoff_point: toGeoPoint(input.dropoff.lat, input.dropoff.lng),
    },
  });
}

/** GET /api/v1/bookings/ — the caller's bookings (as passenger and as driver), optionally for one ride. */
export function listBookings(params: { ride?: string } = {}): Promise<Page<Booking>> {
  const query = params.ride ? `?ride=${encodeURIComponent(params.ride)}` : '';
  return request(`/api/v1/bookings/${query}`, { method: 'GET', auth: true });
}

/** GET /api/v1/bookings/{id}/ */
export function getBooking(id: string): Promise<Booking> {
  return request(`/api/v1/bookings/${id}/`, { method: 'GET', auth: true });
}

/**
 * POST /api/v1/bookings/{id}/transitions/{action}/
 * Driver: accept | reject | complete | no_show | cancel_driver
 * Passenger: confirm (use confirmBooking) | cancel_passenger
 */
export function transitionBooking(id: string, action: BookingAction): Promise<Booking> {
  return request(`/api/v1/bookings/${id}/transitions/${action}/`, { method: 'POST', auth: true });
}

/** GET /api/v1/bookings/{id}/payment-quote/ — passenger only, while ACCEPTED. */
export function paymentQuote(id: string): Promise<PaymentQuote> {
  return request(`/api/v1/bookings/${id}/payment-quote/`, { method: 'GET', auth: true });
}

/** Pays and confirms; refused with 409 if the server total differs from the approved one. */
export function confirmBooking(id: string, expectedOutOfPocket: string): Promise<Booking> {
  return request(`/api/v1/bookings/${id}/transitions/confirm/`, {
    method: 'POST',
    auth: true,
    body: { expected_out_of_pocket: expectedOutOfPocket },
  });
}

/** GET /api/v1/bookings/{id}/cancellation-quote/ — what cancelling now would return. */
export function cancellationQuote(id: string): Promise<CancellationQuote> {
  return request(`/api/v1/bookings/${id}/cancellation-quote/`, { method: 'GET', auth: true });
}
