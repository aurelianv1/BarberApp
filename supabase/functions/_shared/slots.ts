/**
 * Slot calculation. Pure module: no Deno, Supabase or npm dependencies, so it runs unchanged
 * in Edge Functions and under Vitest. Time zone maths uses the built-in Intl API.
 */

export interface SlotSettings {
  /** IANA zone the shop works in, e.g. "Europe/Bucharest". */
  timezone: string;
  slotStepMin: number;
  minNoticeMin: number;
  maxAdvanceDays: number;
}

export interface WorkingInterval {
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** Wall-clock time in the shop's zone, "HH:MM" or "HH:MM:SS". */
  startTime: string;
  endTime: string;
}

export interface TimeRange {
  startsAt: string | Date;
  endsAt: string | Date;
}

export interface ExistingBooking extends TimeRange {
  status: string;
}

export interface SlotInput {
  settings: SlotSettings;
  durationMin: number;
  /** Calendar day in the shop's zone, "YYYY-MM-DD". */
  date: string;
  workingHours: WorkingInterval[];
  timeOff: TimeRange[];
  bookings: ExistingBooking[];
  now: Date;
}

const MINUTE = 60_000;

function toMs(value: string | Date): number {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Invalid date: ${String(value)}`);
  return ms;
}

function parseDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date, expected YYYY-MM-DD: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  return { year, month, day };
}

function parseTime(time: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(time);
  if (!match) throw new Error(`Invalid time, expected HH:MM: ${time}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) {
    throw new Error(`Invalid time: ${time}`);
  }
  return { hour, minute };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/** Wall-clock fields of an instant in the given zone, expressed as a "fake UTC" timestamp. */
function wallClockMs(instantMs: number, timezone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
}

/** Offset of the zone from UTC at the given instant, in milliseconds (east is positive). */
function offsetMs(instantMs: number, timezone: string): number {
  return wallClockMs(instantMs, timezone) - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Converts a wall-clock date and time in `timezone` to a UTC instant (ms).
 * A time skipped by the spring DST change is shifted forward by the length of the gap; a time
 * repeated by the autumn change maps to its first occurrence.
 */
export function zonedTimeToUtcMs(date: string, time: string, timezone: string): number {
  const { year, month, day } = parseDate(date);
  const { hour, minute } = parseTime(time);
  const wall = Date.UTC(year, month - 1, day, hour, minute);

  const dayMs = 24 * 60 * MINUTE;
  const before = offsetMs(wall - dayMs, timezone);
  const after = offsetMs(wall + dayMs, timezone);

  // Candidates use the offsets in force around that day; keep those that round-trip.
  const candidates = [wall - before, wall - after].filter(
    (candidate) => wallClockMs(candidate, timezone) === wall,
  );
  if (candidates.length > 0) return Math.min(...candidates);

  // Skipped wall time (spring forward): the earlier offset shifts it forward past the gap.
  return wall - before;
}

/** Calendar day ("YYYY-MM-DD") of an instant in the given zone. */
export function localDateOf(instant: string | Date, timezone: string): string {
  return new Date(wallClockMs(toMs(instant), timezone)).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Free start times (ISO strings, UTC) for one service on one calendar day.
 *
 * A slot is valid when [start, start + duration) fits entirely inside one working interval,
 * overlaps no confirmed booking and no time off, starts at least `minNoticeMin` from now and
 * falls on a day at most `maxAdvanceDays` after today (both days taken in the shop's zone).
 */
export function computeSlots(input: SlotInput): string[] {
  const { settings, durationMin, date, now } = input;
  const { timezone, slotStepMin, minNoticeMin, maxAdvanceDays } = settings;

  if (!(slotStepMin > 0)) throw new Error('slotStepMin must be positive');
  if (!(durationMin > 0)) throw new Error('durationMin must be positive');
  parseDate(date);

  const today = localDateOf(now, timezone);
  if (date < today || date > addDays(today, maxAdvanceDays)) return [];

  const weekday = weekdayOf(date);
  const earliestStart = now.getTime() + minNoticeMin * MINUTE;
  const stepMs = slotStepMin * MINUTE;
  const durationMs = durationMin * MINUTE;

  const busy: [number, number][] = [
    ...input.bookings
      .filter((booking) => booking.status === 'confirmed')
      .map((booking): [number, number] => [toMs(booking.startsAt), toMs(booking.endsAt)]),
    ...input.timeOff.map((range): [number, number] => [toMs(range.startsAt), toMs(range.endsAt)]),
  ];

  const starts = new Set<number>();
  for (const interval of input.workingHours) {
    if (interval.weekday !== weekday) continue;
    const open = zonedTimeToUtcMs(date, interval.startTime, timezone);
    const close = zonedTimeToUtcMs(date, interval.endTime, timezone);

    for (let start = open; start + durationMs <= close; start += stepMs) {
      const end = start + durationMs;
      if (start < earliestStart) continue;
      if (busy.some(([busyStart, busyEnd]) => start < busyEnd && busyStart < end)) continue;
      starts.add(start);
    }
  }

  return [...starts].sort((a, b) => a - b).map((start) => new Date(start).toISOString());
}

/** True when `startsAt` is one of the free slots for its own calendar day. */
export function isSlotAvailable(input: Omit<SlotInput, 'date'>, startsAt: string | Date): boolean {
  const startMs = toMs(startsAt);
  const date = localDateOf(new Date(startMs), input.settings.timezone);
  return computeSlots({ ...input, date }).includes(new Date(startMs).toISOString());
}
