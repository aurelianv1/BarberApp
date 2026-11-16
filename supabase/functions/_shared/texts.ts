/**
 * Romanian texts sent from the server (push notifications). Pure module.
 * Client UI texts live in src/texts/ro.ts.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Path opened when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other. */
  tag: string;
}

/** "marți, 17 noiembrie" */
function day(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(instant));
}

/** "09:45" */
function time(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

interface BookingInfo {
  shopName: string;
  serviceName: string;
  startsAt: string;
  timezone: string;
  cancelToken: string;
}

export const pushTexts = {
  confirmation: (b: BookingInfo): PushMessage => ({
    title: `${b.shopName}: programare confirmată`,
    body: `${b.serviceName}, ${day(b.startsAt, b.timezone)}, ora ${time(b.startsAt, b.timezone)}.`,
    url: `/booking/${b.cancelToken}`,
    tag: `booking-${b.cancelToken.slice(0, 12)}`,
  }),

  reminder: (b: BookingInfo): PushMessage => ({
    title: `${b.shopName}: îți amintim de programare`,
    body: `${b.serviceName}, ${day(b.startsAt, b.timezone)}, ora ${time(b.startsAt, b.timezone)}. Dacă nu mai poți ajunge, anulează din aplicație.`,
    url: `/booking/${b.cancelToken}`,
    tag: `booking-${b.cancelToken.slice(0, 12)}`,
  }),

  adminNewBooking: (b: {
    customerName: string;
    serviceName: string;
    startsAt: string;
    timezone: string;
  }): PushMessage => ({
    title: 'Programare nouă',
    body: `${b.customerName} · ${b.serviceName} · ${day(b.startsAt, b.timezone)}, ora ${time(b.startsAt, b.timezone)}`,
    url: '/admin',
    tag: `admin-${b.startsAt}`,
  }),

  adminCancelled: (b: {
    customerName: string;
    serviceName: string;
    startsAt: string;
    timezone: string;
  }): PushMessage => ({
    title: 'Programare anulată',
    body: `${b.customerName} · ${b.serviceName} · ${day(b.startsAt, b.timezone)}, ora ${time(b.startsAt, b.timezone)}`,
    url: '/admin',
    tag: `admin-${b.startsAt}`,
  }),
};
