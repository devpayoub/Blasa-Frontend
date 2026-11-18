import { request } from '@/api/client';
import type { AuthUser } from '@/types';

export type ContactChannel = 'PHONE' | 'EMAIL';

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface ContactStatus {
  channel: ContactChannel;
  /** An account already exists for this email/phone. */
  exists: boolean;
  /** That account completed registration and can sign in with a password. */
  has_password: boolean;
}

/**
 * POST /api/v1/auth/contact/check/ — decides whether the login screen reveals
 * the password field or starts the registration steps. Only existence flags are
 * returned; no profile data.
 */
export function checkContact(contact: string): Promise<ContactStatus> {
  return request('/api/v1/auth/contact/check/', { method: 'POST', auth: false, body: { contact } });
}

/** POST /api/v1/auth/password/login/ — password sign-in for registered accounts. */
export function passwordLogin(contact: string, password: string): Promise<TokenPair> {
  return request('/api/v1/auth/password/login/', { method: 'POST', auth: false, body: { contact, password } });
}

/** POST /api/v1/auth/register/complete/ — name, password and role after the OTP proof. */
export function completeRegistration(input: {
  full_name: string;
  password: string;
  role: 'PASSENGER' | 'DRIVER';
}): Promise<AuthUser> {
  return request('/api/v1/auth/register/complete/', { method: 'POST', auth: true, body: input });
}

/** Ask for a login code. The code itself never appears in the response. */
export function requestOtp(phone_number: string): Promise<{ detail: string }> {
  return request('/api/v1/auth/otp/request/', {
    method: 'POST',
    auth: false,
    body: { phone_number },
  });
}

/** Exchange a code for a JWT pair. Creates the account on first login. */
export function verifyOtp(phone_number: string, code: string): Promise<TokenPair> {
  return request('/api/v1/auth/otp/verify/', {
    method: 'POST',
    auth: false,
    body: { phone_number, code },
  });
}

/** Blacklist the refresh token server-side. */
export function logout(refresh: string): Promise<{ detail: string }> {
  return request('/api/v1/auth/logout/', {
    method: 'POST',
    auth: true,
    body: { refresh },
  });
}

export function refreshToken(refresh: string): Promise<TokenPair> {
  return request('/api/v1/auth/token/refresh/', {
    method: 'POST',
    auth: false,
    body: { refresh },
  });
}

export function requestEmailOtp(email: string): Promise<{ detail: string }> {
  return request('/api/v1/auth/email/request/', { method: 'POST', auth: false, body: { email } });
}

export function verifyEmailOtp(email: string, code: string): Promise<TokenPair> {
  return request('/api/v1/auth/email/verify/', { method: 'POST', auth: false, body: { email, code } });
}

export function requestContactCode(channel: ContactChannel, contact: string): Promise<{ detail: string }> {
  return request('/api/v1/auth/contact/request/', { method: 'POST', auth: true, body: { channel, contact } });
}

export function verifyContactCode(channel: ContactChannel, contact: string, code: string): Promise<AuthUser> {
  return request('/api/v1/auth/contact/verify/', { method: 'POST', auth: true, body: { channel, contact, code } });
}
