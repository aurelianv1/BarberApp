import { describe, expect, it } from 'vitest';

import { canCancel, normalizeCustomerName, normalizeRoPhone } from './booking-rules.ts';

describe('normalizeRoPhone', () => {
  it.each([
    ['0712345678', '+40712345678'],
    ['0712 345 678', '+40712345678'],
    ['0712.345.678', '+40712345678'],
    ['(0712) 345-678', '+40712345678'],
    ['+40712345678', '+40712345678'],
    ['+40 712 345 678', '+40712345678'],
    ['0040712345678', '+40712345678'],
    ['40712345678', '+40712345678'],
    ['  0712345678  ', '+40712345678'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeRoPhone(input)).toBe(expected);
  });

  it.each([
    '',
    '712345678', // no prefix
    '071234567', // too short
    '07123456789', // too long
    '0212345678', // landline
    '+41712345678', // not Romanian
    '+4071234567a',
    '07ab345678',
    '+40 0712345678',
    '0712345678; drop table',
  ])('rejects %s', (input) => {
    expect(normalizeRoPhone(input)).toBeNull();
  });
});

describe('normalizeCustomerName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeCustomerName('  Ion   Popescu ')).toBe('Ion Popescu');
  });

  it('accepts diacritics, hyphens and apostrophes', () => {
    expect(normalizeCustomerName('Ștefan Țîrău-Ionescu')).toBe('Ștefan Țîrău-Ionescu');
    expect(normalizeCustomerName("D'Artagnan")).toBe("D'Artagnan");
  });

  it('rejects names that are too short, too long or not names', () => {
    expect(normalizeCustomerName('A')).toBeNull();
    expect(normalizeCustomerName('   ')).toBeNull();
    expect(normalizeCustomerName('a'.repeat(81))).toBeNull();
    expect(normalizeCustomerName('<script>alert(1)</script>')).toBeNull();
    expect(normalizeCustomerName('http://spam.example')).toBeNull();
    expect(normalizeCustomerName('12345')).toBeNull();
  });
});

describe('canCancel', () => {
  const startsAt = '2027-01-13T10:00:00Z';
  const confirmed = { status: 'confirmed', startsAt };

  it('allows cancelling before the deadline, including exactly at it', () => {
    expect(canCancel(confirmed, 120, new Date('2027-01-13T07:00:00Z'))).toEqual({ ok: true });
    expect(canCancel(confirmed, 120, new Date('2027-01-13T08:00:00Z'))).toEqual({ ok: true });
  });

  it('refuses after the deadline', () => {
    expect(canCancel(confirmed, 120, new Date('2027-01-13T08:00:01Z'))).toEqual({
      ok: false,
      reason: 'too_late',
    });
  });

  it('refuses once the booking has started', () => {
    expect(canCancel(confirmed, 0, new Date('2027-01-13T10:00:00Z'))).toEqual({
      ok: false,
      reason: 'already_started',
    });
  });

  it('allows cancelling right up to the start when the deadline is zero', () => {
    expect(canCancel(confirmed, 0, new Date('2027-01-13T09:59:59Z'))).toEqual({ ok: true });
  });

  it.each(['cancelled', 'completed', 'no_show'])('refuses a %s booking', (status) => {
    expect(canCancel({ status, startsAt }, 120, new Date('2027-01-13T07:00:00Z'))).toEqual({
      ok: false,
      reason: 'not_confirmed',
    });
  });
});
