import { describe, expect, it } from 'vitest';

import {
  computeSlots,
  isSlotAvailable,
  localDateOf,
  zonedTimeToUtcMs,
  type SlotInput,
  type WorkingInterval,
} from './slots.ts';

// 2027-01-13 is a Wednesday. Bucharest is UTC+2 in winter, so 09:00 local = 07:00Z.
const WEDNESDAY = '2027-01-13';
const SUNDAY = '2027-01-17';

const weekdayHours = (weekday: number): WorkingInterval[] => [
  { weekday, startTime: '09:00:00', endTime: '13:00:00' },
  { weekday, startTime: '14:00:00', endTime: '18:00:00' },
];

function input(overrides: Partial<SlotInput> = {}): SlotInput {
  return {
    settings: {
      timezone: 'Europe/Bucharest',
      slotStepMin: 15,
      minNoticeMin: 60,
      maxAdvanceDays: 30,
    },
    durationMin: 30,
    date: WEDNESDAY,
    workingHours: [1, 2, 3, 4, 5].flatMap(weekdayHours),
    timeOff: [],
    bookings: [],
    now: new Date('2027-01-11T08:00:00Z'),
    ...overrides,
  };
}

/** Local Bucharest winter time (UTC+2) on the Wednesday, as an ISO string. */
const at = (time: string, date = WEDNESDAY) => new Date(`${date}T${time}:00+02:00`).toISOString();

describe('computeSlots', () => {
  it('returns nothing on a closed day', () => {
    expect(computeSlots(input({ date: SUNDAY }))).toEqual([]);
  });

  it('starts at opening time and steps by slotStepMin', () => {
    const slots = computeSlots(input());
    expect(slots.slice(0, 3)).toEqual([at('09:00'), at('09:15'), at('09:30')]);
  });

  it('keeps the lunch break free', () => {
    const slots = computeSlots(input());
    expect(slots).toContain(at('12:30'));
    expect(slots).not.toContain(at('12:45')); // would run into the break
    expect(slots).not.toContain(at('13:00'));
    expect(slots).not.toContain(at('13:45'));
    expect(slots).toContain(at('14:00'));
  });

  it('drops slots where the service does not fit before closing', () => {
    const slots = computeSlots(input({ durationMin: 45 }));
    expect(slots).toContain(at('12:15'));
    expect(slots).not.toContain(at('12:30'));
    expect(slots.at(-1)).toBe(at('17:15'));
  });

  it('excludes slots overlapping a confirmed booking but allows back-to-back ones', () => {
    const slots = computeSlots(
      input({
        bookings: [{ startsAt: at('10:00'), endsAt: at('10:30'), status: 'confirmed' }],
      }),
    );
    expect(slots).toContain(at('09:30')); // ends exactly when the booking starts
    expect(slots).not.toContain(at('09:45'));
    expect(slots).not.toContain(at('10:00'));
    expect(slots).not.toContain(at('10:15'));
    expect(slots).toContain(at('10:30')); // starts exactly when the booking ends
  });

  it('fits a service exactly between two bookings', () => {
    const slots = computeSlots(
      input({
        bookings: [
          { startsAt: at('09:00'), endsAt: at('10:00'), status: 'confirmed' },
          { startsAt: at('10:30'), endsAt: at('13:00'), status: 'confirmed' },
        ],
      }),
    );
    expect(slots.filter((slot) => slot < at('13:00'))).toEqual([at('10:00')]);
  });

  it('ignores bookings that are not confirmed', () => {
    const slots = computeSlots(
      input({
        bookings: [
          { startsAt: at('10:00'), endsAt: at('10:30'), status: 'cancelled' },
          { startsAt: at('11:00'), endsAt: at('11:30'), status: 'no_show' },
        ],
      }),
    );
    expect(slots).toContain(at('10:00'));
    expect(slots).toContain(at('11:00'));
  });

  it('respects time off', () => {
    const afternoonOff = computeSlots(
      input({ timeOff: [{ startsAt: at('12:00'), endsAt: at('18:00') }] }),
    );
    expect(afternoonOff.at(-1)).toBe(at('11:30'));

    const wholeDayOff = computeSlots(
      input({ timeOff: [{ startsAt: at('00:00'), endsAt: at('00:00', '2027-01-14') }] }),
    );
    expect(wholeDayOff).toEqual([]);
  });

  it('respects the minimum notice', () => {
    const slots = computeSlots(input({ now: new Date(at('09:10')) }));
    expect(slots[0]).toBe(at('10:15'));

    const exact = computeSlots(input({ now: new Date(at('09:15')) }));
    expect(exact[0]).toBe(at('10:15'));
  });

  it('respects the maximum advance window', () => {
    const now = new Date(at('08:00', '2027-01-04')); // Monday
    // +30 days = Wednesday 2027-02-03, +31 days = Thursday 2027-02-04
    expect(computeSlots(input({ now, date: '2027-02-03' })).length).toBeGreaterThan(0);
    expect(computeSlots(input({ now, date: '2027-02-04' }))).toEqual([]);
  });

  it('returns nothing for past days, using the local calendar day', () => {
    // 22:30Z on the 13th is already 00:30 on the 14th in Bucharest.
    const now = new Date('2027-01-13T22:30:00Z');
    expect(computeSlots(input({ now, date: WEDNESDAY }))).toEqual([]);
    expect(computeSlots(input({ now, date: '2027-01-14' })).length).toBeGreaterThan(0);
  });

  it('returns slots sorted and without duplicates when intervals overlap', () => {
    const slots = computeSlots(
      input({
        workingHours: [
          { weekday: 3, startTime: '09:00', endTime: '11:00' },
          { weekday: 3, startTime: '10:00', endTime: '12:00' },
        ],
      }),
    );
    expect(slots).toEqual([...new Set(slots)].sort());
    expect(slots[0]).toBe(at('09:00'));
    expect(slots.at(-1)).toBe(at('11:30'));
  });

  it('rejects malformed input', () => {
    expect(() => computeSlots(input({ date: '2027-02-30' }))).toThrow();
    expect(() => computeSlots(input({ date: '13.01.2027' }))).toThrow();
    expect(() => computeSlots(input({ durationMin: 0 }))).toThrow();
  });
});

describe('daylight saving time (Europe/Bucharest)', () => {
  // 2027: clocks go forward on Sunday 28 March (03:00 -> 04:00)
  // and back on Sunday 31 October (04:00 -> 03:00).
  const sundayOpen: WorkingInterval[] = [{ weekday: 0, startTime: '09:00', endTime: '13:00' }];
  const saturdayOpen: WorkingInterval[] = [{ weekday: 6, startTime: '09:00', endTime: '13:00' }];

  it('uses the summer offset on the day clocks go forward', () => {
    const now = new Date('2027-03-20T08:00:00Z');
    const saturday = computeSlots(input({ now, date: '2027-03-27', workingHours: saturdayOpen }));
    const sunday = computeSlots(input({ now, date: '2027-03-28', workingHours: sundayOpen }));

    expect(saturday[0]).toBe('2027-03-27T07:00:00.000Z'); // 09:00 EET
    expect(sunday[0]).toBe('2027-03-28T06:00:00.000Z'); // 09:00 EEST
    expect(sunday).toHaveLength(saturday.length);
  });

  it('uses the winter offset on the day clocks go back', () => {
    const now = new Date('2027-10-20T08:00:00Z');
    const saturday = computeSlots(input({ now, date: '2027-10-30', workingHours: saturdayOpen }));
    const sunday = computeSlots(input({ now, date: '2027-10-31', workingHours: sundayOpen }));

    expect(saturday[0]).toBe('2027-10-30T06:00:00.000Z'); // 09:00 EEST
    expect(sunday[0]).toBe('2027-10-31T07:00:00.000Z'); // 09:00 EET
    expect(sunday).toHaveLength(saturday.length);
  });

  it('handles working hours that span the change itself', () => {
    const night: WorkingInterval[] = [{ weekday: 0, startTime: '02:00', endTime: '05:00' }];
    const settings = {
      timezone: 'Europe/Bucharest',
      slotStepMin: 60,
      minNoticeMin: 0,
      maxAdvanceDays: 30,
    };

    // Spring: 03:00-04:00 does not exist, so only two real hours.
    const spring = computeSlots(
      input({
        settings,
        durationMin: 60,
        workingHours: night,
        date: '2027-03-28',
        now: new Date('2027-03-20T08:00:00Z'),
      }),
    );
    expect(spring).toEqual(['2027-03-28T00:00:00.000Z', '2027-03-28T01:00:00.000Z']);

    // Autumn: 03:00-04:00 happens twice, so four real hours.
    const autumn = computeSlots(
      input({
        settings,
        durationMin: 60,
        workingHours: night,
        date: '2027-10-31',
        now: new Date('2027-10-20T08:00:00Z'),
      }),
    );
    expect(autumn).toEqual([
      '2027-10-30T23:00:00.000Z',
      '2027-10-31T00:00:00.000Z',
      '2027-10-31T01:00:00.000Z',
      '2027-10-31T02:00:00.000Z',
    ]);
  });
});

describe('time zone helpers', () => {
  it('converts wall-clock time to UTC', () => {
    expect(zonedTimeToUtcMs('2027-01-13', '09:00', 'Europe/Bucharest')).toBe(
      Date.parse('2027-01-13T07:00:00Z'),
    );
    expect(zonedTimeToUtcMs('2027-07-13', '09:00:00', 'Europe/Bucharest')).toBe(
      Date.parse('2027-07-13T06:00:00Z'),
    );
  });

  it('returns the local calendar day of an instant', () => {
    expect(localDateOf('2027-01-13T21:59:59Z', 'Europe/Bucharest')).toBe('2027-01-13');
    expect(localDateOf('2027-01-13T22:00:00Z', 'Europe/Bucharest')).toBe('2027-01-14');
  });
});

describe('isSlotAvailable', () => {
  const base = input();

  it('accepts a free slot and rejects a taken or off-grid one', () => {
    const withBooking = {
      ...base,
      bookings: [{ startsAt: at('10:00'), endsAt: at('10:30'), status: 'confirmed' }],
    };
    expect(isSlotAvailable(withBooking, at('09:30'))).toBe(true);
    expect(isSlotAvailable(withBooking, at('10:00'))).toBe(false);
    expect(isSlotAvailable(withBooking, at('11:07'))).toBe(false);
    expect(isSlotAvailable(withBooking, at('13:15'))).toBe(false);
  });
});
