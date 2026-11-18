/**
 * Single source of truth for user-facing error copy.
 *
 * The API returns machine codes (`error.code`), DRF field errors and domain
 * messages written for developers. Screens must never render those raw — they
 * call `friendlyError()` / `alertError()` so every failure reads like product
 * copy and no internal detail (stack, field name, status) leaks.
 */

import { Alert, Platform } from 'react-native';

export type ErrorKind =
  | 'network'
  | 'timeout'
  | 'validation_error'
  | 'invalid'
  | 'authentication_required'
  | 'permission_denied'
  | 'not_found'
  | 'conflict'
  | 'throttled'
  | 'server_error'
  | 'unavailable'
  | 'unknown';

/** Fallback copy per kind. Keep these short, actionable and blame-free. */
export const ERROR_MESSAGES: Record<ErrorKind, string> = {
  network: "We can't reach Blasa right now. Check your connection and try again.",
  timeout: 'Blasa took too long to respond. Please try again.',
  validation_error: 'Please check the highlighted details and try again.',
  invalid: 'That code or link is no longer valid. Request a new one.',
  authentication_required: 'Your session ended. Please sign in again.',
  permission_denied: "You don't have access to that.",
  not_found: "We couldn't find that. It may have been removed.",
  conflict: "That action isn't available right now. Refresh and try again.",
  throttled: 'Too many attempts. Wait a minute, then try again.',
  server_error: 'Blasa is having a moment. Please try again shortly.',
  unavailable: 'That service is temporarily unavailable. Try again later.',
  unknown: 'Something went wrong. Please try again.',
};

/**
 * Exact backend messages we control, rewritten for people. Matching is
 * case-insensitive and substring-based so trailing punctuation doesn't matter.
 */
const KNOWN_DETAILS: [match: RegExp, copy: string][] = [
  [/code is invalid or expired/i, 'That code is wrong or expired. Request a new one.'],
  [/too many codes requested/i, 'Too many codes requested. Try again in a few minutes.'],
  [/already has a password/i, 'This account is already set up. Sign in with your password.'],
  [/that email\/phone and password don't match/i, "That email or phone and password don't match."],
  [/only passengers can become drivers/i, 'Driver mode is already active for this account.'],
  [/cin must be approved/i, 'Your ID must be approved before you can drive.'],
  [/departure must be in the future/i, 'Choose a departure time in the future.'],
  [/only drivers can publish rides/i, 'Only drivers can publish rides.'],
  [/only confirmed bookings allow new chat messages/i, 'Chat opens once the booking is confirmed.'],
  [/chat is only available after payment confirmation/i, 'Chat opens once the booking is confirmed.'],
  [/insufficient/i, 'Your wallet balance is too low for this payment.'],
  [/not enough seats/i, 'There are not enough seats left on this ride.'],
  [/this code is not valid/i, "That promo code isn't valid."],
  [/identity uploads/i, 'Document uploads are unavailable right now.'],
  [/upload.*(expired|not confirmed)/i, 'The upload expired. Choose the file again.'],
  [/must be at least|at least \d+ characters/i, 'Use a longer password — at least 8 characters.'],
  [/too common|entirely numeric|too similar/i, 'Choose a stronger password.'],
];

const STATUS_KIND: Record<number, ErrorKind> = {
  400: 'validation_error',
  401: 'authentication_required',
  403: 'permission_denied',
  404: 'not_found',
  405: 'conflict',
  409: 'conflict',
  415: 'validation_error',
  429: 'throttled',
  500: 'server_error',
  502: 'server_error',
  503: 'unavailable',
  504: 'timeout',
};

const CODE_KIND: Record<string, ErrorKind> = {
  invalid: 'invalid',
  validation_error: 'validation_error',
  authentication_required: 'authentication_required',
  authentication_failed: 'authentication_required',
  not_authenticated: 'authentication_required',
  permission_denied: 'permission_denied',
  not_found: 'not_found',
  conflict: 'conflict',
  throttled: 'throttled',
  server_error: 'server_error',
  unavailable: 'unavailable',
};

interface ErrorEnvelope {
  error?: { status?: number; code?: string; detail?: unknown };
  detail?: unknown;
}

/** First human-readable string inside a DRF error tree. */
function firstMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstMessage(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['detail', 'error', 'non_field_errors', ...Object.keys(record)]) {
      if (key in record) {
        const found = firstMessage(record[key], depth + 1);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function knownCopy(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  return KNOWN_DETAILS.find(([pattern]) => pattern.test(detail))?.[1];
}

function kindFor(status?: number, code?: string): ErrorKind {
  if (code && CODE_KIND[code]) return CODE_KIND[code];
  if (status && STATUS_KIND[status]) return STATUS_KIND[status];
  return 'unknown';
}

export interface FriendlyErrorOptions {
  /** Copy used when nothing more specific is known (e.g. screen-specific hint). */
  fallback?: string;
}

/** Turn any thrown value into copy that is safe to show in the UI. */
export function friendlyError(error: unknown, options: FriendlyErrorOptions = {}): string {
  if (!error) return options.fallback ?? ERROR_MESSAGES.unknown;

  if (error instanceof Error) {
    if (/abort|timeout|timed out/i.test(error.message)) return ERROR_MESSAGES.timeout;
    if (/network request failed|failed to fetch|load failed|network error/i.test(error.message)) {
      return ERROR_MESSAGES.network;
    }
  }

  const candidate = error as { status?: number; body?: unknown; message?: string };
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;
  const envelope = (candidate.body ?? {}) as ErrorEnvelope;
  const code = envelope.error?.code;
  const detail = firstMessage(envelope.error?.detail ?? envelope.detail) ?? candidate.message;

  const known = knownCopy(detail);
  if (known) return known;

  if (status) {
    // A 400 without a mapped message is almost always a field problem; show the
    // generic form hint rather than the serializer's developer wording.
    return options.fallback ?? ERROR_MESSAGES[kindFor(status, code)];
  }

  return options.fallback ?? ERROR_MESSAGES.unknown;
}

/** Field-level messages for inline form errors, already sanitized. */
export function fieldErrors(error: unknown): Record<string, string> {
  const envelope = ((error as { body?: unknown })?.body ?? {}) as ErrorEnvelope;
  const detail = envelope.error?.detail ?? envelope.detail;
  const out: Record<string, string> = {};
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return out;
  for (const [field, value] of Object.entries(detail as Record<string, unknown>)) {
    const message = firstMessage(value);
    if (message) out[field] = knownCopy(message) ?? ERROR_MESSAGES.validation_error;
  }
  return out;
}

function present(title: string, message: string) {
  if (Platform.OS === 'web') {
    // react-native-web has no native alert; keep the same blocking UX.
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

/** The standard submit-failure alert. Never pass a raw backend message here. */
export function alertError(error: unknown, title = 'Something went wrong', options?: FriendlyErrorOptions) {
  present(title, friendlyError(error, options));
}

export function alertMessage(title: string, message: string) {
  present(title, message);
}
