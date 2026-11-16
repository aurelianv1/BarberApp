import { describe, expect, it } from 'vitest';

import {
  checkInterval,
  dayRange,
  newCancelToken,
  nextStatuses,
  normalizeTime,
  parseIntInRange,
  parsePrice,
  weekOf,
} from './adminRules';

const TZ = 'Europe/Bucharest';

describe('nextStatuses', () => {
  it('lets a confirmed booking be completed, marked no-show or cancelled', () => {
    expect(nextStatuses('confirmed')).toEqual(['completed', 'no_show', 'cancelled']);
  });

  it('always offers a way back to confirmed, and never the current status', () => {
    for (const status of ['completed', 'no_show', 'cancelled'] as const) {
      expect(nextStatuses(status)).toContain('confirmed');
      expect(nextStatuses(status)).not.toContain(status);
    }
  });
});

describe('dayRange', () => {
  it('covers a local day in UTC', () => {
    expect(dayRange('2026-11-18', '2026-11-18', TZ)).toEqual({
      from: '2026-11-17T22:00:00.000Z',
      to: '2026-11-18T22:00:00.000Z',
    });
  });

  it('is 23 and 25 hours long on the days the clocks change', () => {
    const hours = (day: string) => {
      const { from, to } = dayRange(day, day, TZ);
      return (Date.parse(to) - Date.parse(from)) / 3_600_000;
    };
    expect(hours('2027-03-28')).toBe(23);
    expect(hours('2027-10-31')).toBe(25);
  });

  it('covers several days', () => {
    const { from, to } = dayRange('2026-11-16', '2026-11-22', TZ);
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(7);
  });
});

describe('weekOf', () => {
  it('returns Monday to Sunday for any day of that week', () => {
    const week = [
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ];
    expect(weekOf('2026-11-16')).toEqual(week); // Monday
    expect(weekOf('2026-11-18')).toEqual(week); // Wednesday
    expect(weekOf('2026-11-22')).toEqual(week); // Sunday
  });

  it('crosses month and year ends', () => {
    expect(weekOf('2027-01-01')[0]).toBe('2026-12-28');
  });
});

describe('normalizeTime', () => {
  it.each([
    ['09:00', '09:00'],
    ['9:00', '09:00'],
    ['9.30', '09:30'],
    ['0930', '09:30'],
    [' 18:45 ', '18:45'],
    ['23:59', '23:59'],
  ])('%s -> %s', (input, expected) => expect(normalizeTime(input)).toBe(expected));

  it.each(['', '24:00', '9', '12:60', 'abc', '9:5', '123:00'])('rejects %s', (input) =>
    expect(normalizeTime(input)).toBeNull(),
  );
});

describe('checkInterval', () => {
  const morning = { start: '09:00:00', end: '13:00:00' }; // as stored by Postgres

  it('accepts an interval next to an existing one', () => {
    expect(checkInterval({ start: '13:00', end: '18:00' }, [morning])).toBeNull();
    expect(checkInterval({ start: '14:00', end: '18:00' }, [morning])).toBeNull();
  });

  it('rejects overlaps, inverted and malformed intervals', () => {
    expect(checkInterval({ start: '12:00', end: '15:00' }, [morning])).toBe('overlap');
    expect(checkInterval({ start: '08:00', end: '19:00' }, [morning])).toBe('overlap');
    expect(checkInterval({ start: '18:00', end: '14:00' }, [])).toBe('end_before_start');
    expect(checkInterval({ start: '14:00', end: '14:00' }, [])).toBe('end_before_start');
    expect(checkInterval({ start: '9', end: '14:00' }, [])).toBe('invalid');
  });
});

describe('number parsing', () => {
  it('parses prices with a comma or a dot', () => {
    expect(parsePrice('50')).toBe(50);
    expect(parsePrice('49,5')).toBe(49.5);
    expect(parsePrice('49.50')).toBe(49.5);
    expect(parsePrice('0')).toBe(0);
  });

  it('rejects bad prices', () => {
    for (const input of ['', '-5', '12.345', 'abc', '1e3', '1234567']) {
      expect(parsePrice(input)).toBeNull();
    }
  });

  it('parses whole numbers within a range', () => {
    expect(parseIntInRange('30', 5, 480)).toBe(30);
    expect(parseIntInRange('4', 5, 480)).toBeNull();
    expect(parseIntInRange('481', 5, 480)).toBeNull();
    expect(parseIntInRange('30.5', 5, 480)).toBeNull();
    expect(parseIntInRange('', 5, 480)).toBeNull();
  });
});

describe('newCancelToken', () => {
  it('is long, URL-safe and different every time', () => {
    const a = newCancelToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newCancelToken()).not.toBe(a);
  });
});
