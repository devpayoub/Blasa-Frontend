/**
 * App-wide types. The generated API contracts come from the backend's
 * OpenAPI schema (packages/shared-types/api.ts, drift-checked in CI).
 * Geometry (GeoJSON) fields and a few loose endpoints get precise overrides
 * here — the generated file keeps Record<string, unknown> for drf-gis points.
 */
import type * as Api from '@shared/api';
import type { GeoPoint } from '@/lib/geo';

export type { Api };

export type { GeoPoint };

export type { BookingStatusEnum, UserRoleEnum, VerificationDocumentStatusEnum, DocTypeEnum } from '@shared/api';

// --- Enriched domain types -------------------------------------------------

export type BookingStatus = Api.BookingStatusEnum;
export type RideStatus = Api.RideStatusEnum;

export type Atmosphere = Api.AtmosphereEnum;

export type Ride = Omit<Api.Ride, 'origin' | 'destination' | 'status' | 'atmosphere'> & {
  origin: GeoPoint;
  destination: GeoPoint;
  status: RideStatus;
  atmosphere?: Atmosphere | '';
};

/** Profile interest taxonomy; labels come per app language. */
export type InterestTag = Omit<Api.InterestTag, 'labels'> & { labels: Record<'en' | 'fr' | 'ar', string> };

export const ATMOSPHERES: { value: Atmosphere; label: string }[] = [
  { value: 'MUSIC', label: 'Music on' },
  { value: 'CONVERSATION', label: 'Happy to chat' },
  { value: 'QUIET', label: 'Quiet ride' },
];

export type Booking = Omit<Api.Booking, 'pickup_point' | 'dropoff_point' | 'status'> & {
  pickup_point: GeoPoint;
  dropoff_point: GeoPoint;
  status: BookingStatus;
  seats: number;
};

export type Interest = Omit<Api.Interest, 'origin' | 'destination'> & {
  origin: GeoPoint;
  destination: GeoPoint;
};

export type Conversation = Omit<Api.Conversation, 'participants'> & {
  participants: string[];
};

/** Messages have no generated schema (APIView fallback) — contract per serializer. */
export interface Message {
  id: string;
  conversation: string;
  sender: string;
  body: string;
  created_at: string;
}

export type ScoredRide = Omit<Api.ScoredRide, 'origin' | 'destination' | 'status'> & {
  origin: GeoPoint;
  destination: GeoPoint;
  status: RideStatus;
};

export type ScoredInterest = Omit<Api.ScoredInterest, 'origin' | 'destination'> & {
  origin: GeoPoint;
  destination: GeoPoint;
};

export type AuthUser = Omit<Api.User, 'role' | 'profile'> & {
  role: Api.UserRoleEnum;
  profile: Api.Profile | null;
};

export type {
  Rating, Vehicle, VerificationDocument, LedgerEntry, Notification, Voucher, Profile,
  PaymentQuote, CancellationQuote, RideCancellationQuote, RideRefundLine, UserSummary, VehicleSummary,
  PaymentIntent, PaymentIntentStatusEnum, IncentiveAward,
  Campaign, CampaignAnalytics, PromoCode, SponsoredRide, SponsorSummary,
} from '@shared/api';

/** POST /payments/topup/ response: the intent plus what the gateway returned to continue payment. */
export type TopupResult = Api.PaymentIntent & { payment_url?: string | null };

/** GET /wallet/earnings/ — no generated schema (APIView); contract per payments.services.driver_earnings. */
export interface DriverEarnings {
  currency: string;
  gross_fares: string;
  platform_fees: string;
  refunded: string;
  net_earnings: string;
  paid_bookings: number;
  refunded_bookings: number;
}

/** Transition names accepted by POST /bookings/{id}/transitions/{action}/. */
export type BookingAction =
  | 'accept' | 'reject' | 'confirm' | 'complete' | 'no_show' | 'cancel_driver' | 'cancel_passenger';

/** Paginated list envelope (DRF PageNumberPagination, applied globally). */
export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** GET /users/{id}/ — participant trust profile. Never carries contact, document or wallet data. */
export interface PublicReview {
  score: number;
  comment: string;
  created_at: string;
  rater_display_name: string;
}

export interface UserPublicProfile {
  id: string;
  display_name: string;
  bio: string;
  member_since: string;
  is_driver: boolean;
  average_rating: string;
  review_count: number;
  completed_trips: number;
  shared_interests: string[];
  reviews_visible: boolean;
  reviews: PublicReview[];
  is_self: boolean;
}

export type ReportTargetType = 'USER' | 'RIDE' | 'VEHICLE' | 'MESSAGE';

export const REPORT_REASONS: { value: 'HARASSMENT' | 'FRAUD' | 'SAFETY' | 'SPAM' | 'OTHER'; label: string }[] = [
  { value: 'HARASSMENT', label: 'Harassment' },
  { value: 'FRAUD', label: 'Fraud or off-platform payment' },
  { value: 'SAFETY', label: 'Safety concern' },
  { value: 'SPAM', label: 'Spam' },
  { value: 'OTHER', label: 'Something else' },
];

/** The forward booking statuses, in order (accepted by the driver, paid by the passenger, completed with the ride). */
export const BOOKING_FLOW: Extract<BookingStatus, 'ACCEPTED' | 'CONFIRMED' | 'COMPLETED'>[] = [
  'ACCEPTED',
  'CONFIRMED',
  'COMPLETED',
];

/** Human copy for the tracking timeline. Seen by both driver and passenger, so it stays neutral. */
export const BOOKING_STEP_META: Record<BookingStatus, { label: string; hint: string }> = {
  REQUESTED: { label: 'Requested', hint: 'Waiting for the driver to accept' },
  ACCEPTED: { label: 'Accepted', hint: 'The passenger pays to confirm the seats' },
  CONFIRMED: { label: 'Paid', hint: 'Seats are held for this trip' },
  COMPLETED: { label: 'Completed', hint: 'Ride done — leave a rating' },
  REJECTED: { label: 'Rejected', hint: 'The driver could not take this booking' },
  CANCELLED_BY_PASSENGER: { label: 'Cancelled', hint: 'The passenger cancelled. Any payment went back to their wallet.' },
  CANCELLED_BY_DRIVER: { label: 'Cancelled', hint: 'The driver cancelled. Any payment went back to the passenger’s wallet.' },
  NO_SHOW: { label: 'No show', hint: 'The passenger did not show up' },
};

/** Ride statuses during which the driver may still edit, start or cancel. */
export const RIDE_UPCOMING: RideStatus[] = ['OPEN', 'FULL'];
