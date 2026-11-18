import { request } from '@/api/client';
import type { Page, Rating } from '@/types';

/**
 * POST /api/v1/ratings/ — two-way rating after a COMPLETED booking.
 * The backend derives the ratee from the booking + caller role.
 */
export function createRating(booking: string, score: number, comment?: string): Promise<Rating> {
  return request('/api/v1/ratings/', {
    method: 'POST',
    auth: true,
    body: { booking, score, comment: comment || undefined },
  });
}

/** GET /api/v1/ratings/ — ratings the caller received. */
export function listMyRatings(): Promise<Page<Rating>> {
  return request('/api/v1/ratings/', { method: 'GET', auth: true });
}
