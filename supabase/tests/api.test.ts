import { readFileSync } from 'node:fs';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * End-to-end tests for the public booking API (Edge Functions).
 * Needs the local stack: `npx supabase start`, then `npm run test:db`.
 */
const API = process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const PHONE = '+40799000001';
const TEST_PHONES = [PHONE, '+40799000002', '+40799000003'];

let db: pg.Client;
let serviceId: string;
let date: string;

interface ApiResult<T = any> {
  status: number;
  body: T;
}

async function get(path: string): Promise<ApiResult> {
  const response = await fetch(`${API}/${path}`);
  return { status: response.status, body: await response.json() };
}

async function post(path: string, body: unknown): Promise<ApiResult> {
  const response = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const slotsFor = async (day = date) =>
  (await get(`get-slots?service_id=${serviceId}&date=${day}`)).body.slots as string[];

const book = (startsAt: string, overrides: Record<string, unknown> = {}) =>
  post('create-booking', {
    service_id: serviceId,
    starts_at: startsAt,
    customer_name: 'Api Test',
    customer_phone: '0799 000 001',
    consent: true,
    ...overrides,
  });

async function cleanup() {
  await db.query('delete from public.bookings where customer_phone = any($1)', [TEST_PHONES]);
  await db.query('delete from public.rate_limits');
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  await cleanup();

  const services = await get('get-services');
  expect(services.status).toBe(200);
  serviceId = services.body.services.find((s: { name: string }) => s.name === 'Tuns').id;

  // First day, starting the day after tomorrow, that has free slots (skips Sunday).
  for (let offset = 2; offset < 9; offset++) {
    const candidate = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    if ((await slotsFor(candidate)).length >= 6) {
      date = candidate;
      break;
    }
  }
  expect(date).toBeDefined();
});

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await db.end();
});

describe('get-services', () => {
  it('returns the shop details and active services only', async () => {
    const { status, body } = await get('get-services');
    expect(status).toBe(200);
    expect(body.shop).toMatchObject({ timezone: 'Europe/Bucharest', max_advance_days: 30 });
    expect(body.services.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(body.services[0]).sort()).toEqual([
      'duration_min',
      'id',
      'name',
      'price_ron',
    ]);
  });
});

describe('full booking scenario', () => {
  it('list -> slots -> create -> slot taken -> cancel -> slot free again', async () => {
    const before = await slotsFor();
    const slot = before[2]!;

    const created = await book(slot);
    expect(created.status).toBe(200);
    const token: string = created.body.cancel_token;
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(created.body.booking).toMatchObject({
      starts_at: expect.any(String),
      status: 'confirmed',
    });
    expect(new Date(created.body.booking.starts_at).toISOString()).toBe(slot);

    // The slot and the ones overlapping it are gone; a back-to-back one remains.
    const during = await slotsFor();
    expect(during).not.toContain(slot);
    expect(during).not.toContain(before[1]); // starts 15 min earlier, would overlap
    expect(during).toContain(before[0]); // ends exactly when the booking starts

    // Booking the same time again is refused with a clear code.
    const again = await book(slot, { customer_phone: '0799000002' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('slot_taken');

    const fetched = await get(`get-booking?token=${token}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.booking).toMatchObject({
      status: 'confirmed',
      customer_name: 'Api Test',
      can_cancel: true,
      service: { name: 'Tuns', duration_min: 30 },
    });
    // No phone number, internal ids or token in the public view.
    expect(JSON.stringify(fetched.body)).not.toMatch(/0799|"id"|cancel_token|customer_phone/);
    expect(fetched.body.booking.starts_at).toBe(slot);

    const cancelled = await post('cancel-booking', { token });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.booking).toMatchObject({ status: 'cancelled', can_cancel: false });

    expect(await slotsFor()).toEqual(before);

    const cancelledAgain = await post('cancel-booking', { token });
    expect(cancelledAgain.status).toBe(409);
    expect(cancelledAgain.body.error.code).toBe('not_cancellable');
  });

  it('lets exactly one of several simultaneous requests for a slot win', async () => {
    const slot = (await slotsFor())[0]!;
    const results = await Promise.all(
      ['0799000001', '0799000002', '0799000003'].map((customer_phone) =>
        book(slot, { customer_phone }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    for (const result of results.filter((r) => r.status === 409)) {
      expect(result.body.error.code).toBe('slot_taken');
    }
  });
});

describe('create-booking validation', () => {
  it('recomputes availability on the server', async () => {
    const slots = await slotsFor();
    const offGrid = new Date(Date.parse(slots[0]!) + 7 * 60_000).toISOString();
    const midnight = new Date(Date.parse(slots[0]!) - 6 * 3_600_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const tooFar = new Date(Date.now() + 90 * 86_400_000).toISOString();

    for (const startsAt of [offGrid, midnight, past, tooFar]) {
      const result = await book(startsAt);
      expect(result.status).toBe(409);
      expect(result.body.error.code).toBe('slot_taken');
    }
    const { rows } = await db.query(
      'select count(*)::int as n from public.bookings where customer_phone = $1',
      [PHONE],
    );
    expect(rows[0].n).toBe(0);
  });

  it.each([
    ['missing consent', { consent: false }],
    ['bad phone', { customer_phone: '12345' }],
    ['foreign phone', { customer_phone: '+33612345678' }],
    ['empty name', { customer_name: ' ' }],
    ['name with markup', { customer_name: '<b>x</b>' }],
    ['bad service id', { service_id: 'nope' }],
    ['bad date', { starts_at: 'tomorrow' }],
    ['filled honeypot', { website: 'http://spam.example' }],
  ])('rejects %s', async (_label, overrides) => {
    const slot = (await slotsFor())[0]!;
    const result = await book(slot, overrides);
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('invalid_input');
  });

  it('rejects a body that is not JSON', async () => {
    const result = await post('create-booking', 'not json');
    expect(result.status).toBe(400);
  });

  it('rejects an unknown or inactive service', async () => {
    const slot = (await slotsFor())[0]!;
    const result = await book(slot, { service_id: '00000000-0000-4000-8000-000000000000' });
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('service_unavailable');
  });

  it('stores the phone normalized to E.164', async () => {
    const slot = (await slotsFor())[0]!;
    await book(slot, { customer_phone: '(0799) 000-001' });
    const { rows } = await db.query(
      'select customer_phone, source from public.bookings where customer_phone = $1',
      [PHONE],
    );
    expect(rows).toEqual([{ customer_phone: PHONE, source: 'online' }]);
  });

  it('allows at most 3 active bookings per phone', async () => {
    const slots = await slotsFor();
    // Slots 30 minutes apart do not overlap for a 30-minute service.
    const picks = [slots[0]!, slots[2]!, slots[4]!];
    for (const slot of picks) expect((await book(slot)).status).toBe(200);

    const fourth = await book((await slotsFor())[0]!);
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe('too_many_bookings');
  });
});

describe('get-slots', () => {
  it.each([
    ['get-slots', 400],
    ['get-slots?service_id=nope&date=2027-01-13', 400],
    [`get-slots?service_id=00000000-0000-4000-8000-000000000000&date=2027-01-13`, 404],
  ])('%s -> %i', async (path, status) => {
    expect((await get(path)).status).toBe(status);
  });

  it('rejects impossible dates and returns nothing for past days', async () => {
    expect((await get(`get-slots?service_id=${serviceId}&date=2027-02-30`)).status).toBe(400);
    const past = await get(`get-slots?service_id=${serviceId}&date=2020-01-15`);
    expect(past.status).toBe(200);
    expect(past.body.slots).toEqual([]);
  });

  it('respects time off', async () => {
    const before = await slotsFor();
    const staff = (await db.query('select id from public.staff limit 1')).rows[0].id;
    const { rows } = await db.query(
      `insert into public.time_off (staff_id, starts_at, ends_at, reason)
       values ($1, $2::date - interval '1 day', $2::date + interval '2 days', 'api-test') returning id`,
      [staff, date],
    );
    try {
      expect(await slotsFor()).toEqual([]);
    } finally {
      await db.query('delete from public.time_off where id = $1', [rows[0].id]);
    }
    expect(await slotsFor()).toEqual(before);
  });
});

describe('get-booking and cancel-booking', () => {
  it('returns 404 for an unknown token and 400 for a malformed one', async () => {
    expect((await get(`get-booking?token=${'a'.repeat(43)}`)).status).toBe(404);
    expect((await get('get-booking?token=short')).status).toBe(400);
    expect((await post('cancel-booking', { token: 'a'.repeat(43) })).status).toBe(404);
  });

  it('refuses to cancel after the deadline', async () => {
    const created = await book((await slotsFor())[0]!);
    const token = created.body.cancel_token;
    // Move the booking to start in 30 minutes: inside the 120-minute cancellation deadline.
    await db.query(
      `update public.bookings
       set starts_at = now() + interval '30 minutes', ends_at = now() + interval '60 minutes'
       where cancel_token = $1`,
      [token],
    );

    const view = await get(`get-booking?token=${token}`);
    expect(view.body.booking).toMatchObject({
      can_cancel: false,
      cancel_blocked_reason: 'too_late',
    });

    const result = await post('cancel-booking', { token });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('cancel_too_late');

    const { rows } = await db.query('select status from public.bookings where cancel_token = $1', [
      token,
    ]);
    expect(rows[0].status).toBe('confirmed');
  });
});

describe('direct table access with the public key', () => {
  // The key that ships in the web app. Customers must get nothing from the tables with it.
  const REST = (process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1').replace(
    '/functions/v1',
    '/rest/v1',
  );
  const anonKey =
    process.env.ANON_KEY ??
    readFileSync('.env', 'utf8').match(/^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)?.[1] ??
    '';

  it.each(['bookings', 'settings', 'services', 'admins', 'push_subscriptions', 'rate_limits'])(
    'cannot read %s',
    async (table) => {
      expect(anonKey).not.toBe('');
      const response = await fetch(`${REST}/${table}?select=*`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });
      const body = await response.json();
      expect(response.ok).toBe(false);
      expect(Array.isArray(body)).toBe(false);
    },
  );

  it('cannot write bookings or call admin functions', async () => {
    const headers = {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    };
    const insert = await fetch(`${REST}/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ customer_name: 'x' }),
    });
    expect(insert.ok).toBe(false);

    for (const fn of ['delete_customer', 'claim_due_reminders', 'anonymize_old_bookings']) {
      const call = await fetch(`${REST}/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          fn === 'delete_customer' ? { p_booking_id: '00000000-0000-4000-8000-000000000000' } : {},
        ),
      });
      expect(call.ok).toBe(false);
    }
  });
});

describe('transport', () => {
  it('answers CORS preflight and rejects the wrong method', async () => {
    const preflight = await fetch(`${API}/create-booking`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');

    expect((await get('create-booking')).status).toBe(405);
  });

  it('marks responses as not cacheable', async () => {
    const response = await fetch(`${API}/get-slots?service_id=${serviceId}&date=${date}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rate-limits create-booking per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await book('not-a-date')).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
