import { describe, expect, it } from 'vitest';

import { buildIcs, googleCalendarUrl, type CalendarEvent } from './calendar';

const event: CalendarEvent = {
  uid: 'abc123@barberapp',
  startsAt: '2026-11-17T07:45:00.000Z',
  endsAt: '2026-11-17T08:15:00.000Z',
  title: 'Tuns la Frizeria Test',
  location: 'Str. Exemplu nr. 1, București',
  description: 'Poți vedea sau anula programarea aici:',
  url: 'https://example.com/booking/tok_en-123',
  alarmsMinutesBefore: [1440, 120],
  alarmText: 'Ai o programare la Frizeria Test',
};

const NOW = new Date('2026-11-16T19:00:00Z');

describe('buildIcs', () => {
  const ics = buildIcs(event, NOW);
  // Unfold before inspecting individual properties.
  const lines = ics.replace(/\r\n /g, '').split('\r\n');

  it('is a valid single-event calendar with CRLF line endings', () => {
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('UID:abc123@barberapp');
    expect(lines).toContain('DTSTAMP:20261116T190000Z');
  });

  it('writes times in UTC so every calendar shows the right local time', () => {
    expect(lines).toContain('DTSTART:20261117T074500Z');
    expect(lines).toContain('DTEND:20261117T081500Z');
  });

  it('escapes commas and newlines and keeps diacritics', () => {
    expect(lines).toContain('LOCATION:Str. Exemplu nr. 1\\, București');
    expect(lines).toContain(
      'DESCRIPTION:Poți vedea sau anula programarea aici:\\nhttps://example.com/booking/tok_en-123',
    );
  });

  it('adds one alarm per requested lead time', () => {
    expect(lines.filter((line) => line === 'BEGIN:VALARM')).toHaveLength(2);
    expect(lines).toContain('TRIGGER:-PT1440M');
    expect(lines).toContain('TRIGGER:-PT120M');
    expect(lines).toContain('ACTION:DISPLAY');
  });

  it('folds long lines to 75 octets', () => {
    const long = buildIcs({ ...event, description: 'ț'.repeat(200) }, NOW);
    for (const line of long.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(long.replace(/\r\n /g, '')).toContain('ț'.repeat(200));
  });
});

describe('googleCalendarUrl', () => {
  it('builds a prefilled event link', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Tuns la Frizeria Test');
    expect(url.searchParams.get('dates')).toBe('20261117T074500Z/20261117T081500Z');
    expect(url.searchParams.get('location')).toBe('Str. Exemplu nr. 1, București');
    expect(url.searchParams.get('details')).toContain('https://example.com/booking/tok_en-123');
  });
});
