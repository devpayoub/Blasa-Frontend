import { request } from '@/api/client';
import type { Page, Vehicle } from '@/types';

/** GET /api/v1/vehicles/ — the caller's vehicles. */
export function listVehicles(page = 1): Promise<Page<Vehicle>> {
  return request(`/api/v1/vehicles/${page > 1 ? `?page=${page}` : ''}`, { method: 'GET', auth: true });
}

/** POST /api/v1/vehicles/ */
export function createVehicle(input: {
  make: string;
  model: string;
  color: string;
  plate_number: string;
  seats: number;
  carte_grise?: string | null;
}): Promise<Vehicle> {
  return request('/api/v1/vehicles/', { method: 'POST', auth: true, body: input });
}

export function updateVehicle(id: string, input: Partial<Pick<Vehicle, 'make' | 'model' | 'color' | 'plate_number' | 'seats' | 'carte_grise' | 'is_active'>>): Promise<Vehicle> {
  return request(`/api/v1/vehicles/${id}/`, { method: 'PATCH', auth: true, body: input });
}
