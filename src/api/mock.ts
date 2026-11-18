/**
 * In-memory mock API, enabled with EXPO_PUBLIC_MOCK=1 in .env. Intercepts the
 * request() wrapper before any network traffic, so every screen can be browsed
 * and exercised without the Django stack. State is mutable for the lifetime of
 * the bundle: publishing rides, booking, transitions, chat and interests all
 * behave like the real thing.
 *
 * The fixture set is role-scoped: switching the mock user to PASSENGER, DRIVER
 * or BRAND re-seeds rides, bookings and chats so each role sees a coherent
 * world (a driver with incoming requests, a passenger with a completed trip to
 * rate, a brand with empty states).
 */

import type {
  AuthUser,
  Booking,
  BookingStatus,
  Campaign,
  CampaignAnalytics,
  Conversation,
  GeoPoint,
  Interest,
  InterestTag,
  IncentiveAward,
  LedgerEntry,
  Message,
  Notification,
  Page,
  PaymentIntent,
  PromoCode,
  Rating,
  Ride,
  RideStatus,
  SponsoredRide,
  UserPublicProfile,
  UserSummary,
  Vehicle,
  VehicleSummary,
  VerificationDocument,
  Voucher,
} from '@/types';

export const MOCK_ENABLED = process.env.EXPO_PUBLIC_MOCK === '1';

export type MockRole = 'PASSENGER' | 'DRIVER' | 'BRAND';

/** Roles the dev switcher cycles through, in display order. */
export const MOCK_ROLES: MockRole[] = ['PASSENGER', 'DRIVER', 'BRAND'];

const GEO_TUNIS: GeoPoint = { type: 'Point', coordinates: [10.1815, 36.8065] };
const GEO_SUSSE: GeoPoint = { type: 'Point', coordinates: [10.6369, 35.8256] };
const GEO_BIZERTE: GeoPoint = { type: 'Point', coordinates: [9.8731, 37.2746] };
const GEO_SOUSSE_MARINA: GeoPoint = { type: 'Point', coordinates: [10.6398, 35.8178] };

const ME: AuthUser = {
  id: 'user-me',
  phone_number: '+21699000123',
  email: '',
  phone_verified_at: '2026-11-05T10:00:00Z',
  email_verified_at: null,
  onboarding_complete: true,
  role: 'DRIVER',
  preferred_language: 'fr',
  is_verified: true,
  profile: { full_name: 'Mock Driver', avatar_key: '', bio: 'Testing without a backend', average_rating: '4.6', interests: ['music', 'tech'] },
};

/** Demo credential shown on the mock login screen. */
export const MOCK_PASSWORD = 'blasa1234';
/** False while the mock account is mid-registration (OTP verified, no password yet). */
let mockHasPassword = true;
/** Remembers which document type the last mock upload-url asked for. */
let mockPendingDocType: 'CIN' | 'CARTE_GRISE' = 'CIN';

function mockContactMatches(contact: string): boolean {
  const value = contact.trim().toLowerCase();
  return value === ME.phone_number?.toLowerCase() || (Boolean(ME.email) && value === ME.email.toLowerCase());
}

const VEHICLES: Vehicle[] = [
  { id: 'veh-1', make: 'Isuzu', model: 'D-Max', color: 'White', plate_number: '123 TN 4567', seats: 4, carte_grise: null, is_active: true, is_verified: true, is_bookable: true },
  { id: 'veh-2', make: 'Peugeot', model: '301', color: 'Grey', plate_number: '89 TN 2210', seats: 5, carte_grise: null, is_active: true, is_verified: false, is_bookable: false },
];

// --- fixture builders -------------------------------------------------------

type RideSeed = Pick<
  Ride,
  | 'id'
  | 'driver'
  | 'origin'
  | 'destination'
  | 'origin_label'
  | 'destination_label'
  | 'departure_at'
  | 'seats_total'
  | 'seats_available'
  | 'price_per_seat'
  | 'status'
> &
  Partial<Ride>;

const PEOPLE: Record<string, Omit<UserSummary, 'id' | 'shared_interests'> & { interests: string[] }> = {
  'user-me': { display_name: 'Mock D.', average_rating: '4.6', completed_trips: 12, interests: [] },
  'user-other-1': { display_name: 'Amira S.', average_rating: '4.8', completed_trips: 31, interests: ['music', 'culture'] },
  'user-other-2': { display_name: 'Karim B.', average_rating: '4.3', completed_trips: 7, interests: ['sports'] },
  'user-other-3': { display_name: 'Blasa member', average_rating: '0.00', completed_trips: 0, interests: [] },
};

const TAGS: InterestTag[] = [
  ['music', 'Music', 'Musique', 'موسيقى'], ['tech', 'Tech', 'Tech', 'تكنولوجيا'],
  ['entrepreneurship', 'Entrepreneurship', 'Entrepreneuriat', 'ريادة الأعمال'], ['sports', 'Sports', 'Sport', 'رياضة'],
  ['culture', 'Culture', 'Culture', 'ثقافة'], ['politics', 'Politics', 'Politique', 'سياسة'], ['hobbies', 'Hobbies', 'Loisirs', 'هوايات'],
].map(([slug, en, fr, ar]) => ({ slug, labels: { en, fr, ar } }));

/** Like the API: only interests the viewer shares, and none about yourself. */
function personSummary(id: string): UserSummary {
  const { interests, ...person } = PEOPLE[id] ?? PEOPLE['user-other-3'];
  const mine = ME.profile?.interests ?? [];
  return { id, ...person, shared_interests: id === ME.id ? [] : interests.filter((slug) => mine.includes(slug)) };
}

/** Summaries are computed per request, so profile edits show up without re-seeding fixtures. */
function viewRide(ride: Ride): Ride {
  return { ...ride, driver_summary: personSummary(ride.driver) };
}

function vehicleSummary(id: string): VehicleSummary {
  const vehicle = VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
  return { make: vehicle.make, model: vehicle.model, color: vehicle.color, seats: vehicle.seats };
}

function makeRide(seed: RideSeed): Ride {
  const vehicle = seed.vehicle ?? 'veh-1';
  return {
    distance_km: 42, notes: '', atmosphere: '', preferred_interests: [], started_at: null, completed_at: null, cancelled_at: null,
    sponsorship: null,
    driver_summary: personSummary(seed.driver), vehicle_summary: vehicleSummary(vehicle),
    ...seed, vehicle,
  };
}

type BookingSeed = Pick<Booking, 'id' | 'ride' | 'passenger' | 'status' | 'fare_amount'> &
  Partial<Booking>;

function makeBooking(seed: BookingSeed): Booking {
  return {
    seats: 1,
    pickup_point: GEO_TUNIS,
    dropoff_point: GEO_SUSSE,
    subsidy_amount: null,
    voucher_amount: null,
    paid_amount: null,
    refunded_amount: null,
    passenger_summary: personSummary(seed.passenger),
    ...seed,
  };
}

// Access fields are computed from the booking on each chat request, never seeded stale.
type MockConversation = Omit<Conversation, 'booking_status' | 'can_send'>;

interface Fixtures {
  rides: Ride[];
  bookings: Booking[];
  conversations: MockConversation[];
  messages: Message[];
  notifications: Notification[];
}

/**
 * One coherent world per role. Ids stay stable across roles (ride-1, bk-1…) so
 * deep links and screenshots stay comparable when switching persona.
 */
function fixturesFor(role: MockRole): Fixtures {
  if (role === 'DRIVER') {
    return {
      rides: [
        makeRide({
          id: 'ride-1', driver: ME.id, origin: GEO_TUNIS, destination: GEO_SUSSE,
          origin_label: 'Tunis — Lac 1', destination_label: 'Sousse — Centre',
          departure_at: '2026-11-20T07:30:00Z', seats_total: 4, seats_available: 3,
          price_per_seat: '12.500', status: 'OPEN', distance_km: 143.2,
        }),
        makeRide({
          id: 'ride-2', driver: ME.id, vehicle: 'veh-2', origin: GEO_TUNIS, destination: GEO_BIZERTE,
          origin_label: 'Tunis — Bab Saadoun', destination_label: 'Bizerte — Corniche',
          departure_at: '2026-11-18T16:00:00Z', seats_total: 3, seats_available: 1,
          price_per_seat: '8.000', status: 'OPEN', distance_km: 65.5,
        }),
        makeRide({
          id: 'ride-3', driver: 'user-other-1', origin: GEO_TUNIS, destination: GEO_SOUSSE_MARINA,
          origin_label: 'Tunis — Aéroport', destination_label: 'Sousse — Marina',
          departure_at: '2026-11-17T09:00:00Z', seats_total: 4, seats_available: 0,
          price_per_seat: '11.750', status: 'COMPLETED', distance_km: 149.8,
        }),
        makeRide({
          id: 'ride-4', driver: 'user-other-2', vehicle: 'veh-2', origin: GEO_SUSSE, destination: GEO_TUNIS,
          origin_label: 'Sousse — Gare', destination_label: 'Tunis — Lac 2',
          departure_at: '2026-11-19T18:15:00Z', seats_total: 4, seats_available: 0,
          price_per_seat: '13.000', status: 'FULL', distance_km: 143.2,
        }),
      ],
      bookings: [
        // My completed trip as a passenger — rateable from the detail screen.
        makeBooking({ id: 'bk-1', ride: 'ride-3', passenger: ME.id, seats: 2, status: 'COMPLETED', fare_amount: '23.500', paid_amount: '23.500' }),
        // Incoming request on my own ride — accept / reject.
        makeBooking({ id: 'bk-2', ride: 'ride-1', passenger: 'user-other-3', seats: 1, status: 'REQUESTED', fare_amount: '12.500' }),
        // Incoming confirmed booking — complete / no-show.
        makeBooking({ id: 'bk-3', ride: 'ride-2', passenger: 'user-other-4', seats: 2, status: 'CONFIRMED', fare_amount: '16.000', paid_amount: '16.000', dropoff_point: GEO_BIZERTE }),
      ],
      conversations: [
        { id: 'conv-1', booking: 'bk-2', participants: ['user-other-3', ME.id], created_at: '2026-11-16T09:30:00Z' },
        { id: 'conv-2', booking: 'bk-3', participants: ['user-other-4', ME.id], created_at: '2026-11-16T18:05:00Z' },
        { id: 'conv-3', booking: 'bk-1', participants: [ME.id, 'user-other-1'], created_at: '2026-11-16T08:00:00Z' },
      ],
      messages: [
        { id: 'msg-1', conversation: 'conv-1', sender: 'user-other-3', body: 'Salam, je pars de Bab Saadoun avec un sac de sport, ça passe ?', created_at: '2026-11-16T09:31:00Z' },
        { id: 'msg-2', conversation: 'conv-1', sender: ME.id, body: 'Oui sans souci, le coffre est vide.', created_at: '2026-11-16T09:40:00Z' },
        { id: 'msg-3', conversation: 'conv-1', sender: 'user-other-3', body: 'Parfait, à demain.', created_at: '2026-11-16T09:42:00Z' },
        { id: 'msg-4', conversation: 'conv-2', sender: 'user-other-4', body: 'Bonjour, on se retrouve où exactement à Bab Saadoun ?', created_at: '2026-11-16T18:05:00Z' },
        { id: 'msg-5', conversation: 'conv-3', sender: ME.id, body: 'Merci pour le trajet !', created_at: '2026-11-17T12:00:00Z' },
      ],
      notifications: [
        { id: 'ntf-1', kind: 'booking.created', title: 'New booking request', body: 'A passenger requested a seat on your Tunis → Sousse ride.', payload: {}, read_at: null, created_at: '2026-11-16T09:31:00Z' },
        { id: 'ntf-2', kind: 'booking.status_changed', title: 'Ride completed', body: 'Rate your driver for the Sousse — Marina trip.', payload: {}, read_at: '2026-11-17T12:06:00Z', created_at: '2026-11-17T12:00:00Z' },
      ],
    };
  }

  if (role === 'PASSENGER') {
    return {
      rides: [
        makeRide({
          id: 'ride-1', driver: 'user-other-1', origin: GEO_TUNIS, destination: GEO_SUSSE,
          origin_label: 'Tunis — Lac 1', destination_label: 'Sousse — Centre',
          departure_at: '2026-11-20T07:30:00Z', seats_total: 4, seats_available: 3,
          price_per_seat: '12.500', status: 'OPEN', distance_km: 143.2,
        }),
        makeRide({
          id: 'ride-2', driver: 'user-other-2', vehicle: 'veh-2', origin: GEO_TUNIS, destination: GEO_BIZERTE,
          origin_label: 'Tunis — Bab Saadoun', destination_label: 'Bizerte — Corniche',
          departure_at: '2026-11-18T16:00:00Z', seats_total: 3, seats_available: 2,
          price_per_seat: '8.000', status: 'OPEN', distance_km: 65.5,
        }),
        makeRide({
          id: 'ride-3', driver: 'user-other-1', origin: GEO_TUNIS, destination: GEO_SOUSSE_MARINA,
          origin_label: 'Tunis — Aéroport', destination_label: 'Sousse — Marina',
          departure_at: '2026-11-17T09:00:00Z', seats_total: 4, seats_available: 0,
          price_per_seat: '11.750', status: 'COMPLETED', distance_km: 149.8,
        }),
        // Bookable ride with no booking attached — exercises the request flow.
        makeRide({
          id: 'ride-4', driver: 'user-other-3', vehicle: 'veh-2', origin: GEO_TUNIS, destination: GEO_SOUSSE_MARINA,
          origin_label: 'Tunis — Aéroport', destination_label: 'Sousse — Marina',
          departure_at: '2026-11-22T09:00:00Z', seats_total: 4, seats_available: 4,
          price_per_seat: '11.750', status: 'OPEN', distance_km: 149.8,
        }),
      ],
      bookings: [
        // Completed trip — rateable.
        makeBooking({ id: 'bk-1', ride: 'ride-3', passenger: ME.id, seats: 2, status: 'COMPLETED', fare_amount: '23.500', paid_amount: '23.500', dropoff_point: GEO_SOUSSE_MARINA }),
        // Confirmed seat — cancellable.
        makeBooking({ id: 'bk-2', ride: 'ride-1', passenger: ME.id, seats: 1, status: 'CONFIRMED', fare_amount: '12.500', paid_amount: '12.500' }),
        // Pending request — cancellable.
        makeBooking({ id: 'bk-3', ride: 'ride-2', passenger: ME.id, seats: 1, status: 'REQUESTED', fare_amount: '8.000', dropoff_point: GEO_BIZERTE }),
      ],
      conversations: [
        { id: 'conv-1', booking: 'bk-2', participants: [ME.id, 'user-other-1'], created_at: '2026-11-15T10:00:00Z' },
        { id: 'conv-2', booking: 'bk-3', participants: [ME.id, 'user-other-2'], created_at: '2026-11-16T09:30:00Z' },
        { id: 'conv-3', booking: 'bk-1', participants: [ME.id, 'user-other-1'], created_at: '2026-11-16T08:00:00Z' },
      ],
      messages: [
        { id: 'msg-1', conversation: 'conv-1', sender: 'user-other-1', body: 'Salam, on part à 7h30 pile depuis Lac 1 ?', created_at: '2026-11-15T10:02:00Z' },
        { id: 'msg-2', conversation: 'conv-1', sender: ME.id, body: 'Oui, je serai là 10 min avant.', created_at: '2026-11-15T10:05:00Z' },
        { id: 'msg-3', conversation: 'conv-2', sender: ME.id, body: 'Encore 2 places pour Bizerte ?', created_at: '2026-11-16T09:31:00Z' },
        { id: 'msg-4', conversation: 'conv-2', sender: 'user-other-2', body: 'Oui, il en reste 2. Je confirme ce soir.', created_at: '2026-11-16T09:45:00Z' },
        { id: 'msg-5', conversation: 'conv-3', sender: ME.id, body: 'Merci pour le trajet !', created_at: '2026-11-17T12:00:00Z' },
      ],
      notifications: [
        { id: 'ntf-1', kind: 'booking.status_changed', title: 'Booking confirmed', body: 'Your seat to Sousse — Centre is confirmed.', payload: {}, read_at: null, created_at: '2026-11-15T10:10:00Z' },
        { id: 'ntf-2', kind: 'booking.status_changed', title: 'Ride completed', body: 'Rate your driver for the Sousse — Marina trip.', payload: {}, read_at: '2026-11-17T12:06:00Z', created_at: '2026-11-17T12:00:00Z' },
      ],
    };
  }

  // BRAND: no vehicles, no rides driven, no bookings or chats — empty states.
  return {
    rides: [
      makeRide({
        id: 'ride-1', driver: 'user-other-1', origin: GEO_TUNIS, destination: GEO_SUSSE,
        origin_label: 'Tunis — Lac 1', destination_label: 'Sousse — Centre',
        departure_at: '2026-11-20T07:30:00Z', seats_total: 4, seats_available: 3,
        price_per_seat: '12.500', status: 'OPEN', distance_km: 143.2,
      }),
      makeRide({
        id: 'ride-2', driver: 'user-other-2', vehicle: 'veh-2', origin: GEO_TUNIS, destination: GEO_BIZERTE,
        origin_label: 'Tunis — Bab Saadoun', destination_label: 'Bizerte — Corniche',
        departure_at: '2026-11-18T16:00:00Z', seats_total: 3, seats_available: 2,
        price_per_seat: '8.000', status: 'OPEN', distance_km: 65.5,
      }),
      makeRide({
        id: 'ride-3', driver: 'user-other-1', origin: GEO_TUNIS, destination: GEO_SOUSSE_MARINA,
        origin_label: 'Tunis — Aéroport', destination_label: 'Sousse — Marina',
        departure_at: '2026-11-17T09:00:00Z', seats_total: 4, seats_available: 0,
        price_per_seat: '11.750', status: 'COMPLETED', distance_km: 149.8,
      }),
    ],
    bookings: [],
    conversations: [],
    messages: [],
    notifications: [],
  };
}

// Mutable state — replaced in place so the module-level references stay valid.
const RIDES: Ride[] = [];
const BOOKINGS: Booking[] = [];
const CONVERSATIONS: MockConversation[] = [];
const MESSAGES: Message[] = [];
const RATINGS: Rating[] = [];
const NOTIFICATIONS: Notification[] = [];
const NOTIFICATION_PREFERENCES = { push_enabled: false, email_enabled: false, sms_enabled: false, promotions_enabled: false };

let messageSeq = 100;
let currentRole: MockRole = 'DRIVER';

function replaceAll<T>(target: T[], items: T[]): void {
  target.splice(0, target.length, ...items);
}

/** Re-seeds every fixture collection for `role` and points /users/me at it. */
export function applyRoleFixtures(role: MockRole): void {
  currentRole = role;
  ME.role = role;
  ME.profile = {
    average_rating: '4.6',
    avatar_key: '',
    bio: role === 'BRAND' ? 'Brand account — no rides, no bookings' : 'Testing without a backend',
    full_name: role === 'DRIVER' ? 'Mock Driver' : role === 'PASSENGER' ? 'Mock Passenger' : 'Mock Brand',
  };

  const fixtures = fixturesFor(role);
  replaceAll(RIDES, fixtures.rides);
  replaceAll(BOOKINGS, fixtures.bookings);
  replaceAll(CONVERSATIONS, fixtures.conversations);
  replaceAll(MESSAGES, fixtures.messages);
  replaceAll(NOTIFICATIONS, fixtures.notifications);
  replaceAll(RATINGS, []);
  messageSeq = 100;
}

/** Dev switcher entry point — same as applyRoleFixtures, named for intent. */
export function setMockRole(role: MockRole): void {
  applyRoleFixtures(role);
}

/**
 * Keeps the fixtures aligned with the signed-in user. Called by the session
 * store after /users/me resolves, so a reload (where the in-memory role resets)
 * cannot leave a PASSENGER session looking at DRIVER fixtures.
 */
export function syncMockRole(role: MockRole): void {
  if (role !== currentRole) applyRoleFixtures(role);
}

export function getMockRole(): MockRole {
  return currentRole;
}

/**
 * Web dev convenience: a full reload re-evaluates this module, so restore the
 * persona from the persisted session instead of snapping back to DRIVER.
 */
function persistedRole(): MockRole {
  try {
    const storage = (globalThis as { localStorage?: { getItem(key: string): string | null } })
      .localStorage;
    const raw = storage?.getItem('blasa.session');
    if (!raw) return 'DRIVER';
    const role = (JSON.parse(raw) as { state?: { user?: { role?: unknown } } }).state?.user?.role;
    return role === 'PASSENGER' || role === 'DRIVER' || role === 'BRAND' ? role : 'DRIVER';
  } catch {
    return 'DRIVER';
  }
}

const INTERESTS: Interest[] = [
  {
    id: 'int-1', origin: GEO_TUNIS, destination: GEO_SOUSSE_MARINA,
    origin_label: 'Tunis — Menzah 6', destination_label: 'Sousse — Marina',
    earliest_departure: '2026-11-21T07:00:00Z', latest_departure: '2026-11-21T10:00:00Z',
    seats: 1, is_active: true,
  },
  {
    id: 'int-2', origin: GEO_SUSSE, destination: GEO_BIZERTE,
    origin_label: 'Sousse — Centre', destination_label: 'Bizerte — Corniche',
    earliest_departure: '2026-11-22T08:00:00Z', latest_departure: '2026-11-22T12:00:00Z',
    seats: 2, is_active: true,
  },
];

const LEDGER: LedgerEntry[] = [
  { id: 'le-3', kind: 'RIDE_PAYMENT', reference: 'ride_payment:bk-2', description: 'Ride payment for booking bk-2', booking: 'bk-2', amount: '-12.500', created_at: '2026-11-15T09:00:00Z' },
  { id: 'le-4', kind: 'VOUCHER_REDEEM', reference: 'voucher_redeem:bk-2', description: 'Voucher WELCOME-1A2B3C4D5E redeemed on booking bk-2', booking: 'bk-2', amount: '1.500', created_at: '2026-11-15T09:00:00Z' },
  { id: 'le-2', kind: 'TOPUP', reference: 'topup:pi-1', description: 'Wallet topup', booking: null, amount: '50.000', created_at: '2026-11-10T08:00:00Z' },
];

const INTENTS: PaymentIntent[] = [
  { id: 'pi-1', kind: 'TOPUP', gateway: 'FLOUCI', amount: '50.000', currency: 'TND', status: 'PAID', gateway_reference: 'mock-1', created_at: '2026-11-10T07:58:00Z' },
];

const VOUCHERS: Voucher[] = [];

const REWARDS: IncentiveAward[] = [
  { id: 'aw-1', kind: 'WELCOME_CREDIT', campaign_name: 'Welcome credit', amount: '10.000', status: 'ISSUED', code: 'WELCOME-1A2B3C4D5E', expires_at: '2027-02-10T08:00:00Z', redeemed_at: null, created_at: '2026-11-10T08:00:00Z' },
];

let mockTopups = 0;

const DOCUMENTS: VerificationDocument[] = [
  { id: 'doc-1', doc_type: 'CIN', content_type: 'application/pdf', size_bytes: 16, history: [], status: 'APPROVED', uploaded_at: '2026-11-05T10:00:00Z', reviewed_at: '2026-11-06T09:00:00Z', rejection_reason: '', created_at: '2026-11-05T10:00:00Z' },
  { id: 'doc-2', doc_type: 'CARTE_GRISE', content_type: 'application/pdf', size_bytes: 16, history: [], status: 'APPROVED', uploaded_at: '2026-11-05T11:00:00Z', reviewed_at: '2026-11-06T09:00:00Z', rejection_reason: '', created_at: '2026-11-05T11:00:00Z' },
];

// ---- brand portal fixtures -------------------------------------------------

const BRAND = { id: 'brand-1', name: 'Aicha Café', website: 'https://aicha.example', logo_key: '' };

const CAMPAIGNS: Campaign[] = [
  {
    id: 'camp-1',
    brand: BRAND.id,
    brand_name: BRAND.name,
    name: 'Coffee runs',
    discount_per_seat: '2.500',
    budget: '300.000',
    spent: '45.000',
    balance: '255.000',
    starts_at: '2026-11-01T00:00:00Z',
    ends_at: '2026-12-31T23:00:00Z',
    is_active: true,
    paused_at: null,
    audience_interests: ['culture', 'music'],
    promotion_title: 'Free coffee with your ride',
    promotion_body: 'Show your Blasa trip at Aicha Café for a free espresso.',
    promotion_url: 'https://aicha.example/blasa',
    created_at: '2026-11-01T09:00:00Z',
  },
  {
    id: 'camp-2',
    brand: BRAND.id,
    brand_name: BRAND.name,
    name: 'Weekend beach shuttle',
    discount_per_seat: '1.500',
    budget: '150.000',
    spent: '12.000',
    balance: '138.000',
    starts_at: '2026-11-10T00:00:00Z',
    ends_at: null,
    is_active: false,
    paused_at: '2026-11-15T12:00:00Z',
    audience_interests: ['sports'],
    promotion_title: 'Beach weekend',
    promotion_body: 'Discounted seats to La Marsa every Saturday.',
    promotion_url: '',
    created_at: '2026-11-10T09:00:00Z',
  },
];

const SPONSORED: SponsoredRide[] = [
  { id: 'sr-1', campaign: 'camp-1', ride: 'ride-2', ride_label: 'Tunis — Lac 1 → Sousse — Centre', created_at: '2026-11-12T09:00:00Z' },
];

const PROMOS: PromoCode[] = [
  { id: 'pc-1', code: 'AICHA-5TND', amount: '5.000', expires_at: '2026-12-31T23:00:00Z', redeemed_at: null, created_at: '2026-11-12T09:00:00Z' },
];

const CAMPAIGN_COUNTERS: Record<string, { impressions: number; engagements: number; redemptions: number }> = {
  'camp-1': { impressions: 128, engagements: 24, redemptions: 6 },
  'camp-2': { impressions: 41, engagements: 7, redemptions: 1 },
};

function campaignAnalytics(campaign: Campaign): CampaignAnalytics {
  const counters = CAMPAIGN_COUNTERS[campaign.id] ?? { impressions: 0, engagements: 0, redemptions: 0 };
  const budget = Number(campaign.budget);
  const spent = Number(campaign.spent);
  return {
    campaign: campaign.id,
    impressions: counters.impressions,
    engagements: counters.engagements,
    redemptions: counters.redemptions,
    promo_codes_issued: PROMOS.filter((promo) => promo.id.startsWith(`pc-${campaign.id.slice(-1)}`)).length || (campaign.id === 'camp-1' ? 1 : 0),
    subsidy_spend: campaign.spent,
    promo_redemption_value: campaign.id === 'camp-1' ? '5.000' : '0.000',
    promo_value_outstanding: campaign.id === 'camp-1' ? '5.000' : '0.000',
    budget: campaign.budget,
    budget_remaining: (budget - spent).toFixed(3),
    balance: campaign.balance,
    audience_tags: campaign.audience_interests?.length ?? 0,
  };
}

/** Participant-facing profile. Mirrors the API contract: no contact or wallet data. */
function publicProfile(userId: string): UserPublicProfile {
  const person = PEOPLE[userId] ?? PEOPLE['user-other-3'];
  const mine = ME.profile?.interests ?? [];
  return {
    id: userId,
    display_name: person.display_name,
    bio: userId === ME.id ? ME.profile?.bio ?? '' : 'Member of the Blasa community.',
    member_since: '2025-06-01T00:00:00Z',
    is_driver: userId === 'user-other-1' || (userId === ME.id && ME.role === 'DRIVER'),
    average_rating: person.average_rating,
    review_count: person.completed_trips > 0 ? Math.min(person.completed_trips, 12) : 0,
    completed_trips: person.completed_trips,
    shared_interests: userId === ME.id ? [] : person.interests.filter((slug) => mine.includes(slug)),
    reviews_visible: true,
    reviews: person.completed_trips > 0
      ? [{ score: 5, comment: 'On time, easy to talk to.', created_at: '2026-10-02T10:00:00Z', rater_display_name: 'Amira S.' }]
      : [],
    is_self: userId === ME.id,
  };
}

const TRANSITION_STATUS: Record<string, BookingStatus> = {
  accept: 'ACCEPTED',
  reject: 'REJECTED',
  confirm: 'CONFIRMED',
  complete: 'COMPLETED',
  no_show: 'NO_SHOW',
  cancel_passenger: 'CANCELLED_BY_PASSENGER',
  cancel_driver: 'CANCELLED_BY_DRIVER',
};

const MOCK_WALLET_BALANCE = '36.000';

function cancellationQuote(booking: Booking) {
  const paid = booking.status === 'CONFIRMED';
  const holdsSeats = booking.status === 'ACCEPTED' || paid;
  return {
    refund: paid ? booking.paid_amount ?? booking.fare_amount : '0.000',
    subsidy_returned: '0.000',
    voucher_returned: '0.000',
    seats_released: holdsSeats ? booking.seats : 0,
  };
}

function page<T>(results: T[]): Page<T> {
  return { count: results.length, next: null, previous: null, results };
}

/**
 * Normalises a point to GeoJSON. Accepts both { lat, lng } (map pickers and
 * query params) and an already-converted GeoJSON Point — services such as
 * publishRide() convert before the request reaches this layer.
 */
function geo(point: unknown): GeoPoint {
  const raw = point as
    | { lat?: unknown; lng?: unknown; coordinates?: unknown }
    | null
    | undefined;

  if (raw && Array.isArray(raw.coordinates) && raw.coordinates.length >= 2) {
    const [lng, lat] = raw.coordinates as [unknown, unknown];
    return { type: 'Point', coordinates: [Number(lng), Number(lat)] };
  }

  const lat = Number(raw?.lat);
  const lng = Number(raw?.lng);
  return {
    type: 'Point',
    coordinates: [Number.isFinite(lng) ? lng : 0, Number.isFinite(lat) ? lat : 0],
  };
}

/** Bookings the current user may see: their own trips, or trips on their rides. */
function visibleBookings(): Booking[] {
  return BOOKINGS.filter((b) => b.passenger === ME.id || rideDriver(b.ride) === ME.id);
}

function km(a: GeoPoint, lat: number, lng: number): number {
  const [aLng, aLat] = a.coordinates;
  const rad = Math.PI / 180;
  const h = Math.sin(((lat - aLat) * rad) / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(lat * rad) * Math.sin(((lng - aLng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const WHEN_STATUSES: Record<string, RideStatus[]> = {
  upcoming: ['OPEN', 'FULL'], active: ['IN_PROGRESS'], completed: ['COMPLETED'], cancelled: ['CANCELLED'],
};

/** Same rules as the API's RideSearchFilter, without validation or paging. */
function searchRides(q: URLSearchParams): Ride[] {
  const scope = q.get('scope') ?? 'bookable';
  const joined = new Set(BOOKINGS.filter((x) => x.passenger === ME.id).map((x) => x.ride));
  let rides =
    scope === 'mine'
      ? RIDES.filter((r) => r.driver === ME.id)
      : scope === 'joined'
        ? RIDES.filter((r) => joined.has(r.id))
        : RIDES.filter((r) => r.status === 'OPEN' && r.driver !== ME.id && new Date(r.departure_at) > new Date());
  const when = q.get('when');
  if (when) rides = rides.filter((r) => WHEN_STATUSES[when]?.includes(r.status));
  for (const [prefix, field] of [['from', 'origin'], ['to', 'destination']] as const) {
    const lat = q.get(`${prefix}_lat`);
    const lng = q.get(`${prefix}_lng`);
    const radius = Number(q.get(`${prefix}_radius_km`) ?? 10);
    if (lat && lng) rides = rides.filter((r) => km(r[field], Number(lat), Number(lng)) <= radius);
  }
  const after = q.get('departure_after');
  const before = q.get('departure_before');
  if (after) rides = rides.filter((r) => r.departure_at >= after);
  if (before) rides = rides.filter((r) => r.departure_at <= before);
  const maxPrice = q.get('max_price');
  if (maxPrice) rides = rides.filter((r) => Number(r.price_per_seat) <= Number(maxPrice));
  const minSeats = Number(q.get('min_seats') ?? 1);
  rides = rides.filter((r) => scope !== 'bookable' || r.seats_available >= minSeats);
  const atmosphere = q.get('atmosphere');
  if (atmosphere) rides = rides.filter((r) => !r.atmosphere || r.atmosphere === atmosphere);
  if (q.get('shared_interests') === 'true') rides = rides.filter((r) => personSummary(r.driver).shared_interests.length > 0);
  const ordering = q.get('ordering');
  const byTime = (a: Ride, b: Ride) => a.departure_at.localeCompare(b.departure_at);
  if (ordering === 'price') return [...rides].sort((a, b) => Number(a.price_per_seat) - Number(b.price_per_seat) || byTime(a, b));
  if (ordering === 'pickup') {
    const lat = Number(q.get('from_lat'));
    const lng = Number(q.get('from_lng'));
    return [...rides].sort((a, b) => km(a.origin, lat, lng) - km(b.origin, lat, lng) || byTime(a, b));
  }
  const past = when === 'completed' || when === 'cancelled' || (scope !== 'bookable' && !when);
  return [...rides].sort((a, b) => (past ? -byTime(a, b) : byTime(a, b)));
}

function rideDriver(rideId: string): string {
  return RIDES.find((r) => r.id === rideId)?.driver ?? 'user-other-1';
}

// Seed the default persona at module load (restored from the session on web).
applyRoleFixtures(persistedRole());

/** Matches method + path (query stripped) against the mock routes. */
export async function mockRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  // Small delay so loading states are actually visible.
  await new Promise((r) => setTimeout(r, 250));

  const m = method.toUpperCase();
  const p = path.split('?')[0];
  const b = (body ?? {}) as Record<string, unknown>;

  // ---- auth ----
  if (p === '/api/v1/auth/contact/check/' && m === 'POST') {
    const raw = String(b.contact ?? '').trim();
    const channel = raw.includes('@') ? 'EMAIL' : 'PHONE';
    const exists = mockContactMatches(raw);
    return { status: 200, data: { channel, exists, has_password: exists && mockHasPassword } };
  }
  if (p === '/api/v1/auth/password/login/' && m === 'POST') {
    const ok = mockHasPassword
      && mockContactMatches(String(b.contact ?? ''))
      && String(b.password ?? '') === MOCK_PASSWORD;
    return ok
      ? { status: 200, data: { access: 'mock-access', refresh: 'mock-refresh' } }
      : { status: 400, data: { detail: "That email/phone and password don't match." } };
  }
  if (p === '/api/v1/auth/register/complete/' && m === 'POST') {
    if (mockHasPassword) return { status: 400, data: { detail: 'This account already has a password' } };
    const name = String(b.full_name ?? '').trim();
    if (name.length < 2) return { status: 400, data: { full_name: ['Enter your full name.'] } };
    if (String(b.password ?? '').length < 8) return { status: 400, data: { password: ['Use at least 8 characters.'] } };
    if (ME.profile) ME.profile.full_name = name;
    ME.role = b.role === 'DRIVER' ? 'DRIVER' : 'PASSENGER';
    mockHasPassword = true;
    return { status: 200, data: { ...ME, onboarding_complete: true } };
  }
  if (p === '/api/v1/auth/otp/request/' && m === 'POST') return { status: 200, data: { detail: 'Code sent' } };
  if (p === '/api/v1/auth/otp/verify/' && m === 'POST') {
    if (!b.phone_number) return { status: 400, data: { phone_number: ['This field is required.'] } };
    const phone = String(b.phone_number);
    if (!mockContactMatches(phone)) {
      // Simulate a brand-new account: OTP proves the contact, profile is empty.
      applyRoleFixtures('PASSENGER');
      ME.phone_number = phone;
      ME.phone_verified_at = new Date().toISOString();
      ME.email = '';
      ME.email_verified_at = null;
      ME.role = 'PASSENGER';
      ME.is_verified = false;
      if (ME.profile) ME.profile.full_name = '';
      replaceAll(DOCUMENTS, []);
      mockHasPassword = false;
    }
    return { status: 200, data: { access: 'mock-access', refresh: 'mock-refresh' } };
  }
  if (p === '/api/v1/auth/email/request/' && m === 'POST') return { status: 200, data: { detail: 'Synthetic code requested' } };
  if (p === '/api/v1/auth/email/verify/' && m === 'POST') {
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!mockContactMatches(email)) {
      applyRoleFixtures('PASSENGER');
      ME.email = email;
      ME.email_verified_at = new Date().toISOString();
      ME.phone_number = null;
      ME.phone_verified_at = null;
      ME.role = 'PASSENGER';
      ME.is_verified = false;
      if (ME.profile) ME.profile.full_name = '';
      replaceAll(DOCUMENTS, []);
      mockHasPassword = false;
    }
    return { status: 200, data: { access: 'mock-access', refresh: 'mock-refresh' } };
  }
  if (p === '/api/v1/auth/contact/request/' && m === 'POST') return { status: 200, data: { detail: 'Synthetic code requested' } };
  if (p === '/api/v1/auth/contact/verify/' && m === 'POST') {
    if (b.channel === 'EMAIL') { ME.email = String(b.contact); ME.email_verified_at = new Date().toISOString(); }
    else { ME.phone_number = String(b.contact); ME.phone_verified_at = new Date().toISOString(); }
    return { status: 200, data: { ...ME } };
  }
  if (p === '/api/v1/auth/token/refresh/' && m === 'POST') return { status: 200, data: { access: 'mock-access', refresh: 'mock-refresh' } };
  if (p === '/api/v1/auth/logout/' && m === 'POST') return { status: 200, data: { detail: 'Logged out' } };

  // ---- users ----
  if (p === '/api/v1/users/me/become-driver/' && m === 'POST') {
    if (ME.role !== 'DRIVER') applyRoleFixtures('DRIVER');
    ME.is_verified = true;
    return { status: 200, data: { ...ME } };
  }
  if (p === '/api/v1/users/me/' && m === 'PATCH') {
    const patch = b as Partial<typeof ME>;
    if (patch.profile && ME.profile) Object.assign(ME.profile, patch.profile);
    if (patch.preferred_language) ME.preferred_language = patch.preferred_language;
    ME.onboarding_complete = Boolean(ME.profile?.full_name?.trim());
    return { status: 200, data: { ...ME, onboarding_complete: ME.onboarding_complete } };
  }
  if (p.startsWith('/api/v1/users/me/avatar/')) return { status: 503, data: { detail: 'Photo storage is unavailable in mock mode. Use the real API to upload.' } };
  if (p === '/api/v1/users/me/' && m === 'GET') {
    return { status: 200, data: { ...ME, onboarding_complete: Boolean(ME.profile?.full_name?.trim()) } };
  }
  if (p === '/api/v1/users/interest-tags/' && m === 'GET') return { status: 200, data: TAGS };
  const publicUserMatch = p.match(/^\/api\/v1\/users\/([^/]+)\/$/);
  if (publicUserMatch && m === 'GET') {
    return { status: 200, data: publicProfile(decodeURIComponent(publicUserMatch[1])) };
  }

  // ---- vehicles ----
  if (p === '/api/v1/vehicles/' && m === 'POST') {
    const veh: Vehicle = {
      id: `veh-${VEHICLES.length + 1}`,
      make: String(b.make ?? ''), model: String(b.model ?? ''), color: b.color ? String(b.color) : undefined,
      plate_number: String(b.plate_number ?? ''), seats: Number(b.seats) || 4,
      carte_grise: b.carte_grise ? String(b.carte_grise) : null, is_active: true, is_verified: false, is_bookable: false,
    };
    veh.is_verified = DOCUMENTS.some((doc) => doc.id === veh.carte_grise && doc.doc_type === 'CARTE_GRISE' && doc.status === 'APPROVED');
    veh.is_bookable = Boolean(veh.is_verified && veh.is_active);
    VEHICLES.push(veh);
    return { status: 201, data: veh };
  }
  const vehicleMatch = p.match(/^\/api\/v1\/vehicles\/([^/]+)\/$/);
  if (vehicleMatch && m === 'PATCH') {
    const vehicle = VEHICLES.find((item) => item.id === vehicleMatch[1]);
    if (!vehicle) return { status: 404, data: { detail: 'Vehicle not found' } };
    Object.assign(vehicle, b);
    vehicle.is_verified = DOCUMENTS.some((doc) => doc.id === vehicle.carte_grise && doc.doc_type === 'CARTE_GRISE' && doc.status === 'APPROVED');
    vehicle.is_bookable = Boolean(vehicle.is_verified && vehicle.is_active);
    return { status: 200, data: vehicle };
  }
  if (p === '/api/v1/vehicles/' && m === 'GET') return { status: 200, data: page(VEHICLES) };

  // ---- rides ----
  if (p === '/api/v1/rides/near/' && m === 'GET') return { status: 200, data: page(RIDES.filter((r) => r.status === 'OPEN')) };
  if (p === '/api/v1/rides/' && m === 'POST') {
    const ride: Ride = {
      id: `ride-${RIDES.length + 1}`,
      driver: ME.id,
      vehicle: String(b.vehicle ?? 'veh-1'),
      origin: geo(b.origin),
      destination: geo(b.destination),
      origin_label: String(b.origin_label ?? ''),
      destination_label: String(b.destination_label ?? ''),
      departure_at: String(b.departure_at ?? new Date().toISOString()),
      seats_total: Number(b.seats_total) || 1,
      seats_available: Number(b.seats_total) || 1,
      price_per_seat: String(b.price_per_seat ?? '0'),
      status: 'OPEN' as RideStatus,
      distance_km: 42.0,
      notes: String(b.notes ?? ''),
      atmosphere: (b.atmosphere ?? '') as Ride['atmosphere'],
      preferred_interests: Array.isArray(b.preferred_interests) ? b.preferred_interests.map(String) : [],
      started_at: null,
      completed_at: null,
      cancelled_at: null,
      sponsorship: null,
      driver_summary: personSummary(ME.id),
      vehicle_summary: vehicleSummary(String(b.vehicle ?? 'veh-1')),
    };
    RIDES.unshift(ride);
    return { status: 201, data: ride };
  }
  const rideMatch = p.match(/^\/api\/v1\/rides\/([^/]+)\/$/);
  if (rideMatch && m === 'GET') {
    const ride = RIDES.find((r) => r.id === rideMatch[1]);
    return ride ? { status: 200, data: viewRide(ride) } : { status: 404, data: { detail: 'Not found.' } };
  }
  if (rideMatch && m === 'PATCH') {
    const ride = RIDES.find((r) => r.id === rideMatch[1] && r.driver === ME.id);
    if (!ride) return { status: 404, data: { detail: 'Not found.' } };
    if (ride.status !== 'OPEN' && ride.status !== 'FULL') return { status: 409, data: { detail: 'Only upcoming rides can be edited.' } };
    const patch = b as Partial<Ride>;
    if (patch.seats_total != null) {
      const held = ride.seats_total - ride.seats_available;
      if (patch.seats_total < held) return { status: 400, data: { seats_total: ['Fewer seats than already booked.'] } };
      ride.seats_available = patch.seats_total - held;
      ride.seats_total = patch.seats_total;
    }
    if (patch.departure_at) ride.departure_at = patch.departure_at;
    if (patch.price_per_seat) ride.price_per_seat = patch.price_per_seat;
    if (patch.notes != null) ride.notes = patch.notes;
    if (patch.atmosphere != null) ride.atmosphere = patch.atmosphere;
    if (patch.preferred_interests) ride.preferred_interests = patch.preferred_interests;
    return { status: 200, data: viewRide(ride) };
  }
  const rideActionMatch = p.match(/^\/api\/v1\/rides\/([^/]+)\/(start|complete|cancel|cancellation-quote)\/$/);
  if (rideActionMatch) {
    const ride = RIDES.find((r) => r.id === rideActionMatch[1] && r.driver === ME.id);
    if (!ride) return { status: 404, data: { detail: 'Not found.' } };
    const action = rideActionMatch[2];
    const live = BOOKINGS.filter((x) => x.ride === ride.id && ['REQUESTED', 'ACCEPTED', 'CONFIRMED'].includes(x.status));
    const upcoming = ride.status === 'OPEN' || ride.status === 'FULL';
    const now = new Date().toISOString();
    if (action === 'cancellation-quote' && m === 'GET') {
      const lines = live.map((x) => ({ booking: x.id, status: x.status, ...cancellationQuote(x) }));
      const total = lines.reduce((sum, l) => sum + Number(l.refund), 0);
      return {
        status: 200,
        data: {
          allowed: upcoming,
          status: ride.status,
          bookings_cancelled: lines.length,
          paid_bookings: lines.filter((l) => l.status === 'CONFIRMED').length,
          total_refund: total.toFixed(3),
          bookings: lines,
        },
      };
    }
    if (m !== 'POST') return { status: 405, data: { detail: 'Method not allowed.' } };
    if (action === 'start') {
      if (!upcoming) return { status: 409, data: { detail: 'Ride already started.' } };
      Object.assign(ride, { status: 'IN_PROGRESS', started_at: now });
      live.filter((x) => x.status !== 'CONFIRMED').forEach((x) => {
        x.status = x.status === 'REQUESTED' ? 'REJECTED' : 'CANCELLED_BY_DRIVER';
      });
    } else if (action === 'complete') {
      if (ride.status !== 'IN_PROGRESS') return { status: 409, data: { detail: 'Start the ride first.' } };
      Object.assign(ride, { status: 'COMPLETED', completed_at: now });
      live.filter((x) => x.status === 'CONFIRMED').forEach((x) => {
        x.status = 'COMPLETED';
      });
    } else {
      if (!upcoming) return { status: 409, data: { detail: 'Only upcoming rides can be cancelled.' } };
      Object.assign(ride, { status: 'CANCELLED', cancelled_at: now });
      live.forEach((x) => {
        if (x.status === 'CONFIRMED') x.refunded_amount = x.paid_amount ?? x.fare_amount;
        x.status = x.status === 'REQUESTED' ? 'REJECTED' : 'CANCELLED_BY_DRIVER';
      });
    }
    return { status: 200, data: ride };
  }
  if (p === '/api/v1/rides/' && m === 'GET') {
    return { status: 200, data: page(searchRides(new URLSearchParams(path.split('?')[1] ?? '')).map(viewRide)) };
  }

  // ---- bookings ----
  if (p === '/api/v1/bookings/' && m === 'POST') {
    const ride = RIDES.find((r) => r.id === String(b.ride ?? ''));
    const seats = Number(b.seats) || 1;
    const booking: Booking = {
      id: `bk-${BOOKINGS.length + 1}`,
      ride: String(b.ride ?? ''),
      passenger: ME.id,
      seats,
      pickup_point: geo(b.pickup_point),
      dropoff_point: geo(b.dropoff_point),
      status: 'REQUESTED',
      fare_amount: ride ? (Number(ride.price_per_seat) * seats).toFixed(3) : '0.000',
      subsidy_amount: null,
      voucher_amount: null,
      paid_amount: null,
      refunded_amount: null,
      passenger_summary: personSummary(ME.id),
    };
    BOOKINGS.push(booking);
    CONVERSATIONS.push({
      id: `conv-${CONVERSATIONS.length + 1}`, booking: booking.id,
      participants: [ME.id, ride?.driver ?? 'user-other-1'], created_at: new Date().toISOString(),
    });
    if (ride) ride.seats_available = Math.max(0, ride.seats_available - seats);
    return { status: 201, data: booking };
  }
  if (p === '/api/v1/bookings/' && m === 'GET') {
    const ride = new URLSearchParams(path.split('?')[1] ?? '').get('ride');
    return { status: 200, data: page(visibleBookings().filter((x) => !ride || x.ride === ride)) };
  }
  const bookingMatch = p.match(/^\/api\/v1\/bookings\/([^/]+)\/$/);
  if (bookingMatch && m === 'GET') {
    const booking = visibleBookings().find((x) => x.id === bookingMatch[1]);
    return booking ? { status: 200, data: booking } : { status: 404, data: { detail: 'Not found.' } };
  }
  const bookingQuoteMatch = p.match(/^\/api\/v1\/bookings\/([^/]+)\/(payment-quote|cancellation-quote)\/$/);
  if (bookingQuoteMatch && m === 'GET') {
    const booking = visibleBookings().find((x) => x.id === bookingQuoteMatch[1]);
    if (!booking) return { status: 404, data: { detail: 'Not found.' } };
    if (bookingQuoteMatch[2] === 'payment-quote') {
      return {
        status: 200,
        data: {
          fare: booking.fare_amount,
          subsidy: '0.000',
          voucher: '0.000',
          voucher_code: null,
          out_of_pocket: booking.fare_amount,
          balance: MOCK_WALLET_BALANCE,
          sufficient: Number(MOCK_WALLET_BALANCE) >= Number(booking.fare_amount),
        },
      };
    }
    const drives = rideDriver(booking.ride) === ME.id;
    const open = ['REQUESTED', 'ACCEPTED', 'CONFIRMED'].includes(booking.status);
    return {
      status: 200,
      data: { action: drives ? 'cancel_driver' : 'cancel_passenger', allowed: open, status: booking.status, ...cancellationQuote(booking) },
    };
  }
  const transitionMatch = p.match(/^\/api\/v1\/bookings\/([^/]+)\/transitions\/([^/]+)\/$/);
  if (transitionMatch && m === 'POST') {
    const booking = visibleBookings().find((x) => x.id === transitionMatch[1]);
    if (!booking) return { status: 404, data: { detail: 'Not found.' } };
    const next = TRANSITION_STATUS[transitionMatch[2]];
    if (!next) return { status: 400, data: { detail: 'Unknown transition.' } };
    if (next === 'CONFIRMED') booking.paid_amount = booking.fare_amount;
    if (next.startsWith('CANCELLED') && booking.status === 'CONFIRMED') booking.refunded_amount = booking.paid_amount ?? booking.fare_amount;
    booking.status = next;
    return { status: 200, data: booking };
  }

  // ---- conversations ----
  const readableConversations = CONVERSATIONS.filter((conversation) => {
    const booking = BOOKINGS.find((item) => item.id === conversation.booking);
    return conversation.participants.includes(ME.id) && booking && (
      booking.status === 'CONFIRMED' || (booking.paid_amount != null &&
        ['COMPLETED', 'NO_SHOW', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER'].includes(booking.status))
    );
  }).map((conversation) => {
    const booking = BOOKINGS.find((item) => item.id === conversation.booking)!;
    return { ...conversation, booking_status: booking.status, can_send: booking.status === 'CONFIRMED' };
  });
  if (p === '/api/v1/conversations/' && m === 'GET') return { status: 200, data: page(readableConversations) };
  const conversationMatch = p.match(/^\/api\/v1\/conversations\/([^/]+)\/$/);
  if (conversationMatch && m === 'GET') {
    const conversation = readableConversations.find((item) => item.id === decodeURIComponent(conversationMatch[1]));
    return conversation
      ? { status: 200, data: conversation }
      : { status: 404, data: { detail: 'Chat is only available after payment confirmation.' } };
  }
  const messagesMatch = p.match(/^\/api\/v1\/conversations\/([^/]+)\/messages\/$/);
  if (messagesMatch) {
    const conversationId = decodeURIComponent(messagesMatch[1]);
    if (m === 'GET') {
      const conversation = readableConversations.find((item) => item.id === conversationId);
      return conversation
        ? { status: 200, data: MESSAGES.filter((item) => item.conversation === conversation.id) }
        : { status: 404, data: { detail: 'Chat is only available after payment confirmation.' } };
    }
    if (m === 'POST') {
      const conversation = CONVERSATIONS.find((item) => item.id === conversationId && item.participants.includes(ME.id));
      if (!conversation) return { status: 404, data: { detail: 'Chat not found.' } };
      const booking = BOOKINGS.find((item) => item.id === conversation.booking);
      if (booking?.status !== 'CONFIRMED') return { status: 403, data: { detail: 'Only confirmed bookings allow new chat messages.' } };
      if (typeof b.body !== 'string' || !b.body.trim() || b.body.length > 2000) {
        return { status: 400, data: { body: ['Enter a message of up to 2,000 characters.'] } };
      }
      const msg: Message = {
        id: `msg-${messageSeq++}`,
        conversation: conversation.id,
        sender: ME.id,
        body: b.body.trim(),
        created_at: new Date().toISOString(),
      };
      MESSAGES.push(msg);
      return { status: 201, data: msg };
    }
    return { status: 405, data: { detail: 'Method not allowed.' } };
  }

  // ---- interests + matching ----
  if (p === '/api/v1/interests/' && m === 'POST') {
    const interest: Interest = {
      id: `int-${INTERESTS.length + 1}`,
      origin: geo(b.origin),
      destination: geo(b.destination),
      origin_label: String(b.origin_label ?? ''),
      destination_label: String(b.destination_label ?? ''),
      earliest_departure: String(b.earliest_departure ?? ''),
      latest_departure: String(b.latest_departure ?? ''),
      seats: Number(b.seats) || 1,
      is_active: true,
    };
    INTERESTS.push(interest);
    return { status: 201, data: interest };
  }
  if (p === '/api/v1/interests/' && m === 'GET') return { status: 200, data: page(INTERESTS) };
  const interestMatch = p.match(/^\/api\/v1\/interests\/([^/]+)\/$/);
  if (interestMatch && m === 'DELETE') {
    const i = INTERESTS.findIndex((x) => x.id === interestMatch[1]);
    if (i >= 0) INTERESTS.splice(i, 1);
    return { status: 204, data: undefined };
  }
  const matchInterestRides = p.match(/^\/api\/v1\/matching\/interests\/([^/]+)\/rides\/$/);
  if (matchInterestRides && m === 'GET') {
    return {
      status: 200,
      data: page(RIDES.filter((r) => r.status === 'OPEN').map((r, idx) => ({ ...r, score: 0.9 - idx * 0.1 }))),
    };
  }
  const matchRideInterests = p.match(/^\/api\/v1\/matching\/rides\/([^/]+)\/interests\/$/);
  if (matchRideInterests && m === 'GET') {
    return { status: 200, data: page(INTERESTS.map((x, idx) => ({ ...x, score: 0.85 - idx * 0.05 }))) };
  }

  // ---- ratings ----
  if (p === '/api/v1/ratings/' && m === 'POST') {
    const booking = BOOKINGS.find((x) => x.id === String(b.booking ?? ''));
    const rating: Rating = {
      id: `rat-${RATINGS.length + 1}`,
      booking: String(b.booking ?? ''),
      rater: ME.id,
      ratee: booking
        ? booking.passenger === ME.id
          ? rideDriver(booking.ride)
          : booking.passenger
        : ME.id,
      score: Number(b.score) || 5,
      comment: b.comment ? String(b.comment) : undefined,
      created_at: new Date().toISOString(),
    };
    RATINGS.push(rating);
    return { status: 201, data: rating };
  }
  if (p === '/api/v1/ratings/' && m === 'GET') return { status: 200, data: page(RATINGS) };

  // ---- wallet + notifications ----
  if (p === '/api/v1/wallet/me/' && m === 'GET') return { status: 200, data: { balance: (Number(MOCK_WALLET_BALANCE) + mockTopups).toFixed(3), currency: 'TND' } };
  if (p === '/api/v1/wallet/entries/' && m === 'GET') {
    const kinds = new URLSearchParams(path.split('?')[1] ?? '').get('kind')?.split(',').filter(Boolean) ?? [];
    return { status: 200, data: page(kinds.length ? LEDGER.filter((entry) => kinds.includes(entry.kind)) : LEDGER) };
  }
  if (p === '/api/v1/wallet/earnings/' && m === 'GET') {
    if (ME.role !== 'DRIVER') return { status: 403, data: { detail: 'Earnings are available to drivers only.' } };
    return { status: 200, data: { currency: 'TND', gross_fares: '26.000', platform_fees: '2.500', refunded: '0.000', net_earnings: '23.500', paid_bookings: 2, refunded_bookings: 0 } };
  }
  // Offline top-ups settle immediately: there is no gateway page to visit.
  if (p === '/api/v1/payments/topup/' && m === 'POST') {
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount < 1) return { status: 400, data: { amount: ['Ensure this value is greater than or equal to 1.000.'] } };
    const intent: PaymentIntent = { id: `pi-${Date.now()}`, kind: 'TOPUP', gateway: 'FLOUCI', amount: amount.toFixed(3), currency: 'TND', status: 'PAID', gateway_reference: 'mock', created_at: new Date().toISOString() };
    INTENTS.unshift(intent);
    LEDGER.unshift({ id: `le-${intent.id}`, kind: 'TOPUP', reference: `topup:${intent.id}`, description: 'Wallet topup', booking: null, amount: intent.amount, created_at: intent.created_at });
    mockTopups += amount;
    return { status: 201, data: { ...intent, payment_url: null } };
  }
  if (p === '/api/v1/payments/intents/' && m === 'GET') return { status: 200, data: page(INTENTS) };
  const intentMatch = p.match(/^\/api\/v1\/payments\/intents\/([^/]+)\/(cancel\/)?$/);
  if (intentMatch) {
    const intent = INTENTS.find((item) => item.id === intentMatch[1]);
    if (!intent) return { status: 404, data: { detail: 'Not found.' } };
    if (!intentMatch[2] && m === 'GET') return { status: 200, data: intent };
    if (intentMatch[2] && m === 'POST') {
      if (intent.status !== 'PENDING') return { status: 409, data: { detail: 'Only a pending payment can be cancelled' } };
      intent.status = 'CANCELLED';
      return { status: 200, data: intent };
    }
  }
  if (p === '/api/v1/incentives/vouchers/' && m === 'GET') return { status: 200, data: page(VOUCHERS) };
  if (p === '/api/v1/incentives/vouchers/claim/' && m === 'POST') {
    const code = String(b.code ?? '').trim().toUpperCase();
    if (code !== 'BLASA5' || VOUCHERS.some((voucher) => voucher.code === code)) return { status: 400, data: { detail: 'This code is not valid.' } };
    const voucher: Voucher = { id: `vo-${Date.now()}`, code, amount: '5.000', expires_at: null, redeemed_at: null, created_at: new Date().toISOString() };
    VOUCHERS.push(voucher);
    return { status: 201, data: voucher };
  }
  if (p === '/api/v1/incentives/rewards/' && m === 'GET') return { status: 200, data: page(ME.role === 'PASSENGER' ? REWARDS : []) };
  if (p === '/api/v1/notifications/' && m === 'GET') {
    const query = new URLSearchParams(path.split('?')[1] ?? '');
    const requestedPage = Number(query.get('page') ?? 1);
    const notifications = NOTIFICATIONS.filter((item) => query.get('unread') !== 'true' || item.read_at === null)
      .sort((a, c) => c.created_at.localeCompare(a.created_at) || c.id.localeCompare(a.id));
    const size = 20;
    if (!Number.isInteger(requestedPage) || requestedPage < 1 || (requestedPage > 1 && (requestedPage - 1) * size >= notifications.length)) {
      return { status: 404, data: { detail: 'Invalid page.' } };
    }
    const url = (value: number) => `/api/v1/notifications/?page=${value}${query.get('unread') === 'true' ? '&unread=true' : ''}`;
    return { status: 200, data: { count: notifications.length,
      next: requestedPage * size < notifications.length ? url(requestedPage + 1) : null,
      previous: requestedPage > 1 ? url(requestedPage - 1) : null,
      results: notifications.slice((requestedPage - 1) * size, requestedPage * size) } };
  }
  if (p === '/api/v1/notifications/unread-count/' && m === 'GET') {
    return { status: 200, data: { count: NOTIFICATIONS.filter((item) => item.read_at === null).length } };
  }
  if (p === '/api/v1/notifications/read-all/' && m === 'POST') {
    const unread = NOTIFICATIONS.filter((item) => item.read_at === null);
    const now = new Date().toISOString();
    unread.forEach((item) => { item.read_at = now; });
    return { status: 200, data: { updated: unread.length } };
  }
  if (p === '/api/v1/notifications/preferences/' && (m === 'GET' || m === 'PATCH')) {
    if (m === 'PATCH') {
      for (const key of ['push_enabled', 'email_enabled', 'sms_enabled', 'promotions_enabled'] as const) {
        if (key in b && typeof b[key] !== 'boolean') return { status: 400, data: { [key]: ['Must be a valid boolean.'] } };
      }
      for (const key of ['push_enabled', 'email_enabled', 'sms_enabled', 'promotions_enabled'] as const) {
        if (typeof b[key] === 'boolean') NOTIFICATION_PREFERENCES[key] = b[key];
      }
    }
    return { status: 200, data: { ...NOTIFICATION_PREFERENCES, capabilities: { expo: false, fcm: false, email: false, sms: false } } };
  }
  const notifMatch = p.match(/^\/api\/v1\/notifications\/([^/]+)\/read\/$/);
  if (notifMatch && m === 'POST') {
    const notification = NOTIFICATIONS.find((item) => item.id === decodeURIComponent(notifMatch[1]));
    if (!notification) return { status: 404, data: { detail: 'Not found.' } };
    notification.read_at ??= new Date().toISOString();
    return { status: 200, data: notification };
  }
  if (p === '/api/v1/notifications/devices/' && m === 'POST') {
    if (typeof b.token !== 'string' || !b.token.trim() || b.token.length > 255) return { status: 400, data: { detail: 'A valid push token is required.' } };
    if (!['IOS', 'ANDROID', 'WEB'].includes(String(b.platform)) || !['EXPO', 'FCM'].includes(String(b.provider))) return { status: 400, data: { detail: 'Choose a valid platform and provider.' } };
    const expoToken = /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/.test(b.token);
    if (expoToken !== (b.provider === 'EXPO') || (b.provider === 'EXPO' && b.platform === 'WEB')) return { status: 400, data: { detail: 'Use a valid native token with its matching provider.' } };
    return { status: 201, data: { token: b.token, platform: b.platform, provider: b.provider } };
  }
  if (p === '/api/v1/notifications/devices/' && m === 'DELETE') {
    if (typeof b.token !== 'string' || !b.token.trim()) return { status: 400, data: { token: ['This field is required.'] } };
    return { status: 204, data: undefined };
  }

  // ---- moderation ----
  if (p === '/api/v1/moderation/reports/' && m === 'POST') {
    if (!b.target_type || !b.target_id) return { status: 400, data: { detail: 'Choose what you are reporting.' } };
    return {
      status: 201,
      data: {
        id: `rep-${Date.now()}`,
        target_type: b.target_type,
        target_id: b.target_id,
        reason: b.reason ?? 'OTHER',
        details: b.details ?? '',
        status: 'OPEN',
        created_at: new Date().toISOString(),
      },
    };
  }

  // ---- brand portal ----
  if (p === '/api/v1/brands/brands/mine/' && m === 'GET') return { status: 200, data: BRAND };
  if (p === '/api/v1/brands/campaigns/' && m === 'GET') return { status: 200, data: page(CAMPAIGNS) };
  if (p === '/api/v1/brands/campaigns/' && m === 'POST') {
    const campaign: Campaign = {
      id: `camp-${CAMPAIGNS.length + 1}`,
      brand: BRAND.id,
      brand_name: BRAND.name,
      name: String(b.name ?? 'Untitled campaign'),
      discount_per_seat: String(b.discount_per_seat ?? '0.000'),
      budget: String(b.budget ?? '0.000'),
      spent: '0.000',
      balance: '0.000',
      starts_at: (b.starts_at as string | null) ?? null,
      ends_at: (b.ends_at as string | null) ?? null,
      is_active: true,
      paused_at: null,
      audience_interests: Array.isArray(b.audience_interests) ? b.audience_interests.map(String) : [],
      promotion_title: String(b.promotion_title ?? ''),
      promotion_body: String(b.promotion_body ?? ''),
      promotion_url: String(b.promotion_url ?? ''),
      created_at: new Date().toISOString(),
    };
    CAMPAIGNS.unshift(campaign);
    return { status: 201, data: campaign };
  }

  const sponsoredDelete = p.match(/^\/api\/v1\/brands\/campaigns\/([^/]+)\/sponsored-rides\/([^/]+)\/$/);
  if (sponsoredDelete && m === 'DELETE') {
    const index = SPONSORED.findIndex((item) => item.campaign === sponsoredDelete[1] && item.ride === sponsoredDelete[2]);
    if (index >= 0) SPONSORED.splice(index, 1);
    return { status: 204, data: undefined };
  }

  const campaignAction = p.match(/^\/api\/v1\/brands\/campaigns\/([^/]+)\/(pause|resume|analytics|funding-intents|sponsored-rides|promo-codes)\/$/);
  if (campaignAction) {
    const campaign = CAMPAIGNS.find((item) => item.id === campaignAction[1]);
    if (!campaign) return { status: 404, data: { detail: 'Not found.' } };
    const action = campaignAction[2];

    if (action === 'pause' && m === 'POST') {
      campaign.is_active = false;
      campaign.paused_at = new Date().toISOString();
      return { status: 200, data: campaign };
    }
    if (action === 'resume' && m === 'POST') {
      campaign.is_active = true;
      campaign.paused_at = null;
      return { status: 200, data: campaign };
    }
    if (action === 'analytics' && m === 'GET') return { status: 200, data: campaignAnalytics(campaign) };
    if (action === 'funding-intents' && m === 'POST') {
      return {
        status: 201,
        data: { intent: `pi-${Date.now()}`, status: 'PENDING', amount: String(b.amount ?? '0.000'), payment_url: 'https://mock.local/pay' },
      };
    }
    if (action === 'sponsored-rides') {
      if (m === 'GET') return { status: 200, data: SPONSORED.filter((item) => item.campaign === campaign.id) };
      if (m === 'POST') {
        const ride = RIDES.find((item) => item.id === String(b.ride ?? ''));
        if (!ride) return { status: 400, data: { ride: ['Ride not found.'] } };
        const existing = SPONSORED.find((item) => item.campaign === campaign.id && item.ride === ride.id);
        if (existing) return { status: 400, data: { detail: 'This ride is already sponsored by the campaign.' } };
        const sponsored: SponsoredRide = {
          id: `sr-${SPONSORED.length + 1}`,
          campaign: campaign.id,
          ride: ride.id,
          ride_label: `${ride.origin_label} → ${ride.destination_label}`,
          created_at: new Date().toISOString(),
        };
        SPONSORED.push(sponsored);
        return { status: 201, data: sponsored };
      }
    }
    if (action === 'promo-codes') {
      if (m === 'GET') return { status: 200, data: PROMOS };
      if (m === 'POST') {
        const promo: PromoCode = {
          id: `pc-${PROMOS.length + 1}`,
          code: `AICHA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          amount: String(b.amount ?? '5.000'),
          expires_at: null,
          redeemed_at: null,
          created_at: new Date().toISOString(),
        };
        PROMOS.unshift(promo);
        return { status: 201, data: promo };
      }
    }
    return { status: 405, data: { detail: 'Method not allowed.' } };
  }

  const campaignMatch = p.match(/^\/api\/v1\/brands\/campaigns\/([^/]+)\/$/);
  if (campaignMatch) {
    const campaign = CAMPAIGNS.find((item) => item.id === campaignMatch[1]);
    if (!campaign) return { status: 404, data: { detail: 'Not found.' } };
    if (m === 'GET') return { status: 200, data: campaign };
    if (m === 'PATCH') {
      for (const key of ['name', 'discount_per_seat', 'budget', 'starts_at', 'ends_at', 'promotion_title', 'promotion_body', 'promotion_url'] as const) {
        if (key in b) (campaign as unknown as Record<string, unknown>)[key] = b[key];
      }
      if (Array.isArray(b.audience_interests)) campaign.audience_interests = b.audience_interests.map(String);
      return { status: 200, data: campaign };
    }
  }

  const sponsorshipEvent = p.match(/^\/api\/v1\/brands\/sponsorship\/([^/]+)\/events\/$/);
  if (sponsorshipEvent && m === 'POST') {
    const sponsored = SPONSORED.find((item) => item.ride === sponsorshipEvent[1]);
    const campaign = sponsored && CAMPAIGNS.find((item) => item.id === sponsored.campaign);
    if (!campaign) return { status: 404, data: { detail: 'Not found.' } };
    const counters = (CAMPAIGN_COUNTERS[campaign.id] ??= { impressions: 0, engagements: 0, redemptions: 0 });
    if (b.kind === 'IMPRESSION') counters.impressions += 1;
    if (b.kind === 'ENGAGEMENT') counters.engagements += 1;
    return { status: 200, data: { recorded: true } };
  }

  // ---- verification ----
  if (p === '/api/v1/verification/documents/' && m === 'GET') return { status: 200, data: page(DOCUMENTS) };
  if (p === '/api/v1/verification/documents/upload-url/' && m === 'POST') {
    // Mock storage: no bytes leave the device, but the flow can be completed.
    mockPendingDocType = b.doc_type === 'CARTE_GRISE' ? 'CARTE_GRISE' : 'CIN';
    return {
      status: 201,
      data: { document_id: `doc-${DOCUMENTS.length + 1}`, upload_url: 'mock://upload', expires_in: 900 },
    };
  }
  const confirmMatch = p.match(/^\/api\/v1\/verification\/documents\/([^/]+)\/confirm-upload\/$/);
  if (confirmMatch && m === 'POST') {
    const docType = mockPendingDocType;
    const document: VerificationDocument = {
      id: confirmMatch[1],
      doc_type: docType,
      content_type: 'application/pdf',
      size_bytes: 1024,
      history: [{ decision: 'APPROVE', actor: 'staff', reason: 'Mock auto-approval for the demo flow.', timestamp: new Date().toISOString() }],
      status: 'APPROVED',
      uploaded_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
      rejection_reason: '',
      created_at: new Date().toISOString(),
    };
    DOCUMENTS.unshift(document);
    if (docType === 'CIN') ME.is_verified = true;
    return { status: 200, data: document };
  }
  const downloadMatch = p.match(/^\/api\/v1\/verification\/documents\/([^/]+)\/download-url\/$/);
  if (downloadMatch && m === 'GET') return { status: 200, data: { download_url: 'https://mock.local/document.pdf', expires_in: 900 } };

  return { status: 404, data: { detail: `Mock API: no route for ${m} ${p}` } };
}
