/** Pure rules for the admin panel (no network, no React), covered by unit tests. */
import { addDays } from './datetime';
import { zonedTimeToUtcMs } from './shared';

export type BookingStatus = 'confirmed' | 'cancelled' | 'completed' | 'no_show';

/** Statuses the barber may move a booking to from its current one. */
export function nextStatuses(status: BookingStatus): BookingStatus[] {
  switch (status) {
    case 'confirmed':
      return ['completed', 'no_show', 'cancelled'];
    case 'completed':
      return ['no_show', 'confirmed'];
    case 'no_show':
      return ['completed', 'confirmed'];
    case 'cancelled':
      return ['confirmed']; // may fail if the time was given to someone else
  }
}

/** UTC range [from, to) covering local calendar days `first`..`last` (inclusive). */
export function dayRange(
  first: string,
  last: string,
  timezone: string,
): { from: string; to: string } {
  return {
    from: new Date(zonedTimeToUtcMs(first, '00:00', timezone)).toISOString(),
    to: new Date(zonedTimeToUtcMs(addDays(last, 1), '00:00', timezone)).toISOString(),
  };
}

/** The Monday-to-Sunday week containing `date`. */
export function weekOf(date: string): string[] {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const monday = addDays(date, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "9:00", "09.00", "0900" -> "09:00"; null when it is not a time of day. */
export function normalizeTime(input: string): string | null {
  const compact = input.trim().replace(/[.,;h ]/g, ':');
  const match = /^(\d{1,2}):?(\d{2})$/.exec(compact);
  if (!match) return null;
  const value = `${match[1]!.padStart(2, '0')}:${match[2]}`;
  return TIME.test(value) ? value : null;
}

export interface Interval {
  start: string; // "HH:MM"
  end: string;
}

export type IntervalError = 'invalid' | 'end_before_start' | 'overlap';

/** Checks a new working interval against the day's existing ones. */
export function checkInterval(candidate: Interval, existing: Interval[]): IntervalError | null {
  if (!TIME.test(candidate.start) || !TIME.test(candidate.end)) return 'invalid';
  if (candidate.end <= candidate.start) return 'end_before_start';
  const overlaps = existing.some(
    (interval) =>
      candidate.start < interval.end.slice(0, 5) && interval.start.slice(0, 5) < candidate.end,
  );
  return overlaps ? 'overlap' : null;
}

/** Parses "50", "49,5", "49.50" into a non-negative price with at most two decimals. */
export function parsePrice(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(normalized)) return null;
  return Number(normalized);
}

/** Parses a whole number within [min, max]. */
export function parseIntInRange(input: string, min: number, max: number): number | null {
  if (!/^\d{1,6}$/.test(input.trim())) return null;
  const value = Number(input.trim());
  return value >= min && value <= max ? value : null;
}

/** Random URL-safe token for cancel links (same shape as the server's). */
export function newCancelToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
