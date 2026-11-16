/**
 * Remembers the customer's bookings in this browser (localStorage), so that coming back to
 * the site shows them without the original link. Only the secret link token and the start
 * time are stored; details are always fetched fresh.
 */

export interface SavedBooking {
  token: string;
  startsAt: string;
}

/** Minimal storage surface, so the logic can be tested without a browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'barberapp.bookings.v1';
const MAX_SAVED = 5;
/** Keep a booking visible for a short while after it started. */
const GRACE_MS = 2 * 60 * 60 * 1000;

function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage blocked (private mode, strict settings)
  }
}

function read(store: KeyValueStore | null): SavedBooking[] {
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedBooking =>
        typeof item?.token === 'string' &&
        typeof item?.startsAt === 'string' &&
        !Number.isNaN(Date.parse(item.startsAt)),
    );
  } catch {
    return [];
  }
}

function write(store: KeyValueStore | null, bookings: SavedBooking[]): void {
  try {
    store?.setItem(KEY, JSON.stringify(bookings));
  } catch {
    // Storage full or blocked: remembering the booking is a convenience, not a requirement.
  }
}

/** Upcoming saved bookings, soonest first. Past ones are dropped. */
export function listSavedBookings(now = new Date(), store = browserStore()): SavedBooking[] {
  const all = read(store);
  const upcoming = all
    .filter((booking) => Date.parse(booking.startsAt) + GRACE_MS > now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (upcoming.length !== all.length) write(store, upcoming);
  return upcoming;
}

export function saveBooking(booking: SavedBooking, now = new Date(), store = browserStore()): void {
  const others = listSavedBookings(now, store).filter((item) => item.token !== booking.token);
  const next = [...others, booking]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, MAX_SAVED);
  write(store, next);
}

export function forgetBooking(token: string, store = browserStore()): void {
  write(
    store,
    read(store).filter((booking) => booking.token !== token),
  );
}
