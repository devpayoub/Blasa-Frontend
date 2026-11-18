import type { ContactChannel } from '@/services/auth';

export function normalizeContact(raw: string, channel: ContactChannel): string | null {
  if (channel === 'EMAIL') {
    const email = raw.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }
  const digits = raw.replace(/[\s()-]/g, '');
  if (/^\+216\d{8}$/.test(digits)) return digits;
  if (/^216\d{8}$/.test(digits)) return `+${digits}`;
  if (/^0\d{8}$/.test(digits)) return `+216${digits.slice(1)}`;
  if (/^\d{8}$/.test(digits)) return `+216${digits}`;
  return null;
}

/**
 * One login field accepts either identifier. `@` selects email, everything else
 * is normalized as a Tunisian number.
 */
export function detectContact(raw: string): { channel: ContactChannel; contact: string } | null {
  if (raw.includes('@')) {
    const email = normalizeContact(raw, 'EMAIL');
    return email ? { channel: 'EMAIL', contact: email } : null;
  }
  const phone = normalizeContact(raw, 'PHONE');
  return phone ? { channel: 'PHONE', contact: phone } : null;
}
