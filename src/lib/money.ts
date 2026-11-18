/**
 * Money formatting for the Blasa wallet. The backend stores fare amounts as
 * decimal strings ("12.500") in TND with millime precision — display them as-is.
 */
export function formatTnd(amount: string | number | null | undefined): string {
  if (amount == null) return '—';
  return `${amount} TND`;
}

/** "Free" when zero, otherwise the formatted amount. */
export function formatFareOrFree(amount: string | number | null | undefined): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  return !n ? 'Free' : formatTnd(amount);
}

/** Signed rendering for ledger entries: + credit, − debit. */
export function formatLedgerAmount(amount: string | number): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  const value = formatTnd(String(Math.abs(n).toFixed(3)));
  return `${n < 0 ? '−' : '+'} ${value}`;
}
