/**
 * GeoJSON Point helpers. The backend (django-rest-framework-gis) exchanges
 * points as GeoJSON: { type: "Point", coordinates: [lng, lat] } — note the
 * lng-first order, while the map APIs and /rides/near use lat/lng params.
 */
export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

export function toGeoPoint(lat: number, lng: number): GeoPoint {
  return { type: 'Point', coordinates: [lng, lat] };
}

/** (lat, lng) out of a GeoJSON point. */
export function latLng(point: GeoPoint | null | undefined): { lat: number; lng: number } | null {
  if (!point?.coordinates?.length) return null;
  const [lng, lat] = point.coordinates;
  return { lat, lng };
}

export function formatCoords(point: GeoPoint | null | undefined): string {
  const ll = latLng(point);
  return ll ? `${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}` : '—';
}
