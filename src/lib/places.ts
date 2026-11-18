/** City centres for discovery; a 15 km radius covers each metro area without bleeding into the next city. */
export interface City {
  name: string;
  lat: number;
  lng: number;
}

export const CITY_RADIUS_KM = 15;

export const CITIES: City[] = [
  { name: 'Tunis', lat: 36.8065, lng: 10.1815 },
  { name: 'Ariana', lat: 36.8625, lng: 10.1956 },
  { name: 'La Marsa', lat: 36.8782, lng: 10.3247 },
  { name: 'Bizerte', lat: 37.2744, lng: 9.8739 },
  { name: 'Nabeul', lat: 36.4561, lng: 10.7376 },
  { name: 'Hammamet', lat: 36.4, lng: 10.6167 },
  { name: 'Sousse', lat: 35.8256, lng: 10.6084 },
  { name: 'Monastir', lat: 35.7643, lng: 10.8113 },
  { name: 'Mahdia', lat: 35.5047, lng: 11.0622 },
  { name: 'Kairouan', lat: 35.6781, lng: 10.0963 },
  { name: 'Sfax', lat: 34.7406, lng: 10.7603 },
  { name: 'Gabès', lat: 33.8815, lng: 10.0982 },
  { name: 'Djerba', lat: 33.875, lng: 10.8575 },
  { name: 'Le Kef', lat: 36.1826, lng: 8.7149 },
  { name: 'Tozeur', lat: 33.9197, lng: 8.1335 },
];
