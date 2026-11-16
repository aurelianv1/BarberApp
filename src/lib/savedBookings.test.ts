import { beforeEach, describe, expect, it } from 'vitest';

import { forgetBooking, listSavedBookings, saveBooking, type KeyValueStore } from './savedBookings';

const NOW = new Date('2026-11-16T20:00:00Z');
const at = (iso: string, token: string) => ({ token, startsAt: iso });

let data: Map<string, string>;
let store: KeyValueStore;

beforeEach(() => {
  data = new Map();
  store = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
});

describe('savedBookings', () => {
  it('returns saved bookings soonest first', () => {
    saveBooking(at('2026-11-19T08:00:00Z', 'later'), NOW, store);
    saveBooking(at('2026-11-17T08:00:00Z', 'sooner'), NOW, store);
    expect(listSavedBookings(NOW, store).map((b) => b.token)).toEqual(['sooner', 'later']);
  });

  it('does not duplicate a booking saved twice', () => {
    saveBooking(at('2026-11-17T08:00:00Z', 'a'), NOW, store);
    saveBooking(at('2026-11-17T08:00:00Z', 'a'), NOW, store);
    expect(listSavedBookings(NOW, store)).toHaveLength(1);
  });

  it('drops bookings that are over, after a short grace period', () => {
    saveBooking(at('2026-11-16T19:00:00Z', 'just-started'), NOW, store);
    saveBooking(at('2026-11-16T10:00:00Z', 'this-morning'), NOW, store);
    expect(listSavedBookings(NOW, store).map((b) => b.token)).toEqual(['just-started']);
  });

  it('forgets a cancelled booking', () => {
    saveBooking(at('2026-11-17T08:00:00Z', 'a'), NOW, store);
    saveBooking(at('2026-11-18T08:00:00Z', 'b'), NOW, store);
    forgetBooking('a', store);
    expect(listSavedBookings(NOW, store).map((b) => b.token)).toEqual(['b']);
  });

  it('keeps at most 5 bookings', () => {
    for (let day = 17; day < 25; day++) {
      saveBooking(at(`2026-11-${day}T08:00:00Z`, `t${day}`), NOW, store);
    }
    expect(listSavedBookings(NOW, store)).toHaveLength(5);
  });

  it('survives corrupted or missing storage', () => {
    data.set('barberapp.bookings.v1', '{not json');
    expect(listSavedBookings(NOW, store)).toEqual([]);
    data.set('barberapp.bookings.v1', JSON.stringify([{ token: 1 }, null, 'x']));
    expect(listSavedBookings(NOW, store)).toEqual([]);

    expect(listSavedBookings(NOW, null)).toEqual([]);
    expect(() => saveBooking(at('2026-11-17T08:00:00Z', 'a'), NOW, null)).not.toThrow();

    const broken: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => saveBooking(at('2026-11-17T08:00:00Z', 'a'), NOW, broken)).not.toThrow();
  });
});
