import { describe, expect, it } from 'vitest';

import { pushTexts } from './texts.ts';

const booking = {
  shopName: 'Frizeria Test',
  serviceName: 'Tuns',
  startsAt: '2026-11-17T07:45:00.000Z',
  timezone: 'Europe/Bucharest',
  cancelToken: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
};

describe('pushTexts', () => {
  it('writes the confirmation in Romanian, in the shop time zone, with the shop name', () => {
    expect(pushTexts.confirmation(booking)).toEqual({
      title: 'Frizeria Test: programare confirmată',
      body: 'Tuns, marți, 17 noiembrie, ora 09:45.',
      url: '/booking/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
      tag: 'booking-abcdefghijkl',
    });
  });

  it('writes the reminder with a way out', () => {
    const message = pushTexts.reminder(booking);
    expect(message.title).toBe('Frizeria Test: îți amintim de programare');
    expect(message.body).toContain('marți, 17 noiembrie, ora 09:45');
    expect(message.body).toContain('anulează');
  });

  it('never puts a phone number in a notification', () => {
    const visible = [
      pushTexts.confirmation(booking),
      pushTexts.reminder(booking),
      pushTexts.adminNewBooking({ ...booking, customerName: 'Ion Popescu' }),
      pushTexts.adminCancelled({ ...booking, customerName: 'Ion Popescu' }),
    ]
      .map((message) => `${message.title} ${message.body}`)
      .join(' ');
    expect(visible).not.toMatch(/\+?\d{9,}/);
  });

  it('tells the barber who booked what and when', () => {
    expect(pushTexts.adminNewBooking({ ...booking, customerName: 'Ion Popescu' }).body).toBe(
      'Ion Popescu · Tuns · marți, 17 noiembrie, ora 09:45',
    );
  });
});
