import { localDateOf } from './shared';

const LOCALE = 'ro-RO';

/** Adds days to a "YYYY-MM-DD" calendar date. */
export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The next `count` calendar days in the shop's zone, starting today. */
export function upcomingDays(timezone: string, count: number, now = new Date()): string[] {
  const today = localDateOf(now, timezone);
  return Array.from({ length: count }, (_, index) => addDays(today, index));
}

// Calendar dates carry no zone, so they are formatted as UTC noon to avoid any day shift.
const atNoonUtc = (date: string) => new Date(`${date}T12:00:00Z`);

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Parts for a compact day chip, e.g. { weekday: "mie.", day: "18", month: "nov." }. */
export function dayChipParts(date: string): { weekday: string; day: string; month: string } {
  const value = atNoonUtc(date);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', ...options }).format(value);
  return {
    weekday: capitalize(part({ weekday: 'short' })),
    day: part({ day: 'numeric' }),
    month: part({ month: 'short' }),
  };
}

/** "miercuri, 18 noiembrie" for a calendar date. */
export function formatDay(date: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(atNoonUtc(date));
}

/** "09:30" for an instant, in the shop's zone. */
export function formatTime(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

/** "miercuri, 18 noiembrie 2026" for an instant, in the shop's zone. */
export function formatLongDate(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(instant));
}

/** "50 lei" / "49,50 lei". */
export function formatPrice(priceRon: number): string {
  const amount = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: Number.isInteger(priceRon) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(priceRon);
  return `${amount} lei`;
}

/** Splits slots into morning (before 12:00 local) and afternoon. */
export function groupSlots(
  slots: string[],
  timezone: string,
): { morning: string[]; afternoon: string[] } {
  const morning: string[] = [];
  const afternoon: string[] = [];
  for (const slot of slots) {
    (formatTime(slot, timezone) < '12:00' ? morning : afternoon).push(slot);
  }
  return { morning, afternoon };
}

/** "+40712345678" -> "0712 345 678". Anything else is returned unchanged. */
export function formatPhone(phone: string): string {
  const match = /^\+40(7\d{2})(\d{3})(\d{3})$/.exec(phone);
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : phone;
}
