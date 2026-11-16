/**
 * Booking business rules. Pure module (no Deno, Supabase or npm dependencies) so it can be
 * unit-tested with Vitest and reused by the Edge Functions.
 */

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 80;
export const MAX_ACTIVE_BOOKINGS_PER_PHONE = 3;

/**
 * Normalizes a Romanian mobile number to E.164 ("+407XXXXXXXX").
 * Accepts "07xx xxx xxx", "+40 7xx...", "0040 7xx...", "407xx..." with spaces, dots, dashes
 * or parentheses. Returns null for anything else.
 */
export function normalizeRoPhone(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;

  let national: string;
  if (compact.startsWith('+40')) national = compact.slice(3);
  else if (compact.startsWith('0040')) national = compact.slice(4);
  else if (compact.startsWith('40') && compact.length === 11) national = compact.slice(2);
  else if (compact.startsWith('0') && !compact.startsWith('00')) national = compact.slice(1);
  else return null;

  return /^7\d{8}$/.test(national) ? `+40${national}` : null;
}

/** Trims and collapses whitespace; returns null when the name is not acceptable. */
export function normalizeCustomerName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) return null;
  // Letters (any script), spaces, apostrophes, dots and hyphens.
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(name)) return null;
  return name;
}

export type CancelCheck =
  { ok: true } | { ok: false; reason: 'not_confirmed' | 'already_started' | 'too_late' };

/** Latest instant (ms) at which the customer may still cancel. */
export function cancelDeadlineMs(startsAt: string | Date, cancelDeadlineMin: number): number {
  return new Date(startsAt).getTime() - cancelDeadlineMin * 60_000;
}

/**
 * A customer may cancel a confirmed booking up to `cancelDeadlineMin` minutes before it starts
 * (the deadline instant itself is still allowed).
 */
export function canCancel(
  booking: { status: string; startsAt: string | Date },
  cancelDeadlineMin: number,
  now: Date,
): CancelCheck {
  if (booking.status !== 'confirmed') return { ok: false, reason: 'not_confirmed' };
  if (now.getTime() >= new Date(booking.startsAt).getTime()) {
    return { ok: false, reason: 'already_started' };
  }
  if (now.getTime() > cancelDeadlineMs(booking.startsAt, cancelDeadlineMin)) {
    return { ok: false, reason: 'too_late' };
  }
  return { ok: true };
}
