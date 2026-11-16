import { describe, expect, it } from 'vitest';

import {
  addDays,
  dayChipParts,
  formatDay,
  formatLongDate,
  formatPhone,
  formatPrice,
  formatTime,
  groupSlots,
  upcomingDays,
} from './datetime';

const TZ = 'Europe/Bucharest';

describe('datetime', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('lists upcoming days from the shop-local today', () => {
    // 22:30Z on the 16th is already the 17th in Bucharest.
    expect(upcomingDays(TZ, 3, new Date('2026-11-16T22:30:00Z'))).toEqual([
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
    ]);
  });

  it('formats times in the shop zone regardless of the device zone', () => {
    expect(formatTime('2026-11-18T07:30:00Z', TZ)).toBe('09:30');
    expect(formatTime('2026-07-18T07:30:00Z', TZ)).toBe('10:30');
  });

  it('formats dates in Romanian', () => {
    expect(formatLongDate('2026-11-18T07:30:00Z', TZ)).toBe('miercuri, 18 noiembrie 2026');
    expect(formatDay('2026-11-18')).toBe('miercuri, 18 noiembrie');
    expect(dayChipParts('2026-11-18')).toEqual({ weekday: 'Mie.', day: '18', month: 'nov.' });
  });

  it('formats Romanian mobile numbers for display', () => {
    expect(formatPhone('+40712345678')).toBe('0712 345 678');
    expect(formatPhone('021 000 00 00')).toBe('021 000 00 00');
  });

  it('formats prices', () => {
    expect(formatPrice(50)).toBe('50 lei');
    expect(formatPrice(49.5)).toBe('49,50 lei');
  });

  it('groups slots into morning and afternoon by local time', () => {
    const slots = [
      '2026-11-18T07:00:00.000Z',
      '2026-11-18T09:45:00.000Z',
      '2026-11-18T10:00:00.000Z',
    ];
    expect(groupSlots(slots, TZ)).toEqual({
      morning: slots.slice(0, 2), // 09:00, 11:45
      afternoon: slots.slice(2), // 12:00
    });
  });
});
