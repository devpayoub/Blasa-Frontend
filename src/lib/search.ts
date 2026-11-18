/** Pure discovery helpers (no React, no date-fns) so the rules stay unit-testable. */

export type DayPart = 'any' | 'morning' | 'afternoon' | 'evening';

export const DAY_PARTS: { value: DayPart; label: string; from: number; to: number }[] = [
  { value: 'any', label: 'Any time', from: 0, to: 24 },
  { value: 'morning', label: 'Morning', from: 5, to: 12 },
  { value: 'afternoon', label: 'Afternoon', from: 12, to: 18 },
  { value: 'evening', label: 'Evening', from: 18, to: 24 },
];

/** Local midnight `offset` days from `now`. */
export function dayStart(now: Date, offset: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
}

/** Departure range for a chosen day and part of day; no day means no time limit. */
export function departureWindow(
  now: Date,
  dayOffset: number | null,
  part: DayPart,
): { departureAfter?: string; departureBefore?: string } {
  if (dayOffset === null) return {};
  const day = dayStart(now, dayOffset);
  const range = DAY_PARTS.find((p) => p.value === part) ?? DAY_PARTS[0];
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), range.from);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), range.to);
  const after = start < now && end > now ? now : start;
  return { departureAfter: after.toISOString(), departureBefore: end.toISOString() };
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Consecutive rides on the same local day share a section; input order is preserved. */
export function groupByDay<T extends { departure_at: string }>(items: T[]): { key: string; date: Date; data: T[] }[] {
  const sections: { key: string; date: Date; data: T[] }[] = [];
  for (const item of items) {
    const date = new Date(item.departure_at);
    const key = dayKey(date);
    const last = sections[sections.length - 1];
    if (last?.key === key) last.data.push(item);
    else sections.push({ key, date, data: [item] });
  }
  return sections;
}

/** Empty is allowed (no limit); otherwise a positive TND amount with up to 3 decimals. */
export function maxPriceError(text: string): string | null {
  const value = text.trim().replace(',', '.');
  if (!value) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(value) || Number(value) <= 0) return 'Enter a TND amount above 0, e.g. 15 or 12.500';
  return null;
}
