import crypto from 'node:crypto';
import http from 'node:http';

// @ts-expect-error the package ships no types
import ece from 'http_ece';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Push notifications and reminders, end to end against the local stack. A fake push service
 * runs in this process; the Edge Functions reach it through host.docker.internal (allowed
 * only locally, via PUSH_EXTRA_HOSTS in supabase/functions/.env).
 */
const API = process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const CRON_SECRET = 'local-cron-secret';
const PUSH_PORT = 54399;
const PUSH_HOST = `host.docker.internal:${PUSH_PORT}`;
const PHONE = '+40799000010';
const ADMIN_ID = '00000000-0000-0000-0000-0000000000bb';

interface Received {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

let db: pg.Client;
let server: http.Server;
let received: Received[] = [];
/** Paths for which the fake push service answers 410 Gone. */
const gonePaths = new Set<string>();
let staffId: string;
let serviceId: string;

/** A browser-side subscription pointing at the fake push service. */
function fakeBrowser(name: string) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  const path = `/push/${name}-${crypto.randomBytes(4).toString('hex')}`;
  return {
    path,
    subscription: {
      endpoint: `http://${PUSH_HOST}${path}`,
      keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth },
    },
    read(request: Received) {
      const plain = ece.decrypt(request.body, {
        version: 'aes128gcm',
        privateKey: ecdh,
        authSecret: auth,
      });
      return JSON.parse(plain.toString('utf8')) as { title: string; body: string; url: string };
    },
  };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

const runReminders = () => post('send-reminders', {}, { 'x-cron-secret': CRON_SECRET });

/** Waits until the fake push service has received `count` requests for `path`. */
async function waitFor(path: string, count = 1, timeoutMs = 5000): Promise<Received[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const matches = received.filter((request) => request.path === path);
    if (matches.length >= count || Date.now() > deadline) return matches;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Inserts a booking directly, `hoursAhead` from now, optionally back-dating its creation. */
async function insertBooking(
  hoursAhead: number,
  options: { createdDaysAgo?: number; status?: string } = {},
): Promise<{ id: string; token: string }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const { rows } = await db.query(
    `insert into public.bookings
       (staff_id, service_id, starts_at, ends_at, customer_name, customer_phone, cancel_token,
        status, created_at)
     values ($1, $2, now() + make_interval(hours => $3),
             now() + make_interval(hours => $3, mins => 30), 'Push Test', $4, $5, $6,
             now() - make_interval(days => $7))
     returning id`,
    [
      staffId,
      serviceId,
      hoursAhead,
      PHONE,
      token,
      options.status ?? 'confirmed',
      options.createdDaysAgo ?? 0,
    ],
  );
  return { id: rows[0].id, token };
}

const subscriptionCount = async (bookingId: string): Promise<number> =>
  (
    await db.query(
      'select count(*)::int as n from public.push_subscriptions where booking_id = $1',
      [bookingId],
    )
  ).rows[0].n;

async function cleanup() {
  await db.query('delete from public.bookings where customer_phone = $1', [PHONE]);
  await db.query('delete from public.push_subscriptions where admin_user_id = $1', [ADMIN_ID]);
  await db.query('delete from public.rate_limits');
  received = [];
  gonePaths.clear();
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  staffId = (await db.query('select id from public.staff limit 1')).rows[0].id;
  serviceId = (await db.query(`select id from public.services where name = 'Tuns'`)).rows[0].id;

  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const path = req.url ?? '';
      received.push({ path, headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = gonePaths.has(path) ? 410 : 201;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(PUSH_PORT, '0.0.0.0', resolve));
});

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await db.query('delete from auth.users where id = $1', [ADMIN_ID]);
  await db.end();
  await new Promise((resolve) => server.close(resolve));
});

describe('subscribe-push', () => {
  it('stores the subscription and delivers an encrypted confirmation', async () => {
    const booking = await insertBooking(72);
    const browser = fakeBrowser('confirm');

    const result = await post('subscribe-push', {
      token: booking.token,
      subscription: browser.subscription,
    });
    expect(result).toEqual({ status: 200, body: { subscribed: true, delivered: true } });

    const [request] = await waitFor(browser.path);
    expect(request).toBeDefined();
    expect(request!.headers['content-encoding']).toBe('aes128gcm');
    expect(request!.headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
    expect(Number(request!.headers.ttl)).toBeGreaterThan(0);

    const message = browser.read(request!);
    expect(message.title).toBe('Frizeria Test: programare confirmată');
    expect(message.body).toMatch(/^Tuns, .+, ora \d{2}:\d{2}\.$/);
    expect(message.url).toBe(`/booking/${booking.token}`);
    // Nothing readable on the wire.
    expect(request!.body.toString('latin1')).not.toContain('Frizeria');
  });

  it('does not resend the confirmation when the same browser subscribes again', async () => {
    const booking = await insertBooking(72);
    const browser = fakeBrowser('twice');
    const payload = { token: booking.token, subscription: browser.subscription };

    await post('subscribe-push', payload);
    const second = await post('subscribe-push', payload);
    expect(second.body).toEqual({ subscribed: true, delivered: false });

    expect(await waitFor(browser.path, 2, 500)).toHaveLength(1);
    expect(await subscriptionCount(booking.id)).toBe(1);
  });

  it('refuses endpoints that are not a real push service', async () => {
    const booking = await insertBooking(72);
    const browser = fakeBrowser('ssrf');
    for (const endpoint of [
      'https://evil.example/collect',
      'http://127.0.0.1:54322/',
      'http://kong:8000/rest/v1/bookings',
    ]) {
      const result = await post('subscribe-push', {
        token: booking.token,
        subscription: { ...browser.subscription, endpoint },
      });
      expect(result.status).toBe(400);
    }
    expect(await subscriptionCount(booking.id)).toBe(0);
  });

  it('rejects an unknown token and a cancelled booking', async () => {
    const browser = fakeBrowser('nope');
    const unknown = await post('subscribe-push', {
      token: 'a'.repeat(43),
      subscription: browser.subscription,
    });
    expect(unknown.status).toBe(404);

    const cancelled = await insertBooking(72, { status: 'cancelled' });
    const result = await post('subscribe-push', {
      token: cancelled.token,
      subscription: browser.subscription,
    });
    expect(result.status).toBe(409);
  });

  it('forgets a subscription the push service reports as gone', async () => {
    const booking = await insertBooking(72);
    const browser = fakeBrowser('gone');
    gonePaths.add(browser.path);

    const result = await post('subscribe-push', {
      token: booking.token,
      subscription: browser.subscription,
    });
    expect(result.body).toEqual({ subscribed: true, delivered: false });
    expect(await subscriptionCount(booking.id)).toBe(0);
  });
});

describe('send-reminders', () => {
  it('is hidden without the cron secret', async () => {
    expect((await post('send-reminders', {})).status).toBe(404);
    expect((await post('send-reminders', {}, { 'x-cron-secret': 'wrong' })).status).toBe(404);
  });

  it('reminds only bookings that are due, exactly once', async () => {
    const due = await insertBooking(23, { createdDaysAgo: 3 });
    const bookedInsideWindow = await insertBooking(21); // created just now
    const tooFarAhead = await insertBooking(72, { createdDaysAgo: 3 });
    const cancelled = await insertBooking(19, { createdDaysAgo: 3, status: 'cancelled' });

    const browsers = {
      due: fakeBrowser('due'),
      inside: fakeBrowser('inside'),
      far: fakeBrowser('far'),
    };
    await post('subscribe-push', { token: due.token, subscription: browsers.due.subscription });
    await post('subscribe-push', {
      token: bookedInsideWindow.token,
      subscription: browsers.inside.subscription,
    });
    await post('subscribe-push', {
      token: tooFarAhead.token,
      subscription: browsers.far.subscription,
    });
    await waitFor(browsers.far.path);
    received = []; // drop the three confirmations

    const first = await runReminders();
    expect(first).toEqual({ status: 200, body: { claimed: 1, sent: 1, failed: 0 } });

    const [request] = await waitFor(browsers.due.path);
    const message = browsers.due.read(request!);
    expect(message.title).toBe('Frizeria Test: îți amintim de programare');
    expect(message.url).toBe(`/booking/${due.token}`);
    expect(received).toHaveLength(1);

    // A second run finds nothing left to do.
    const second = await runReminders();
    expect(second.body).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(received).toHaveLength(1);

    const { rows } = await db.query(
      `select id, reminder_sent_at is not null as reminded from public.bookings
       where customer_phone = $1`,
      [PHONE],
    );
    const reminded = Object.fromEntries(rows.map((row) => [row.id, row.reminded]));
    expect(reminded).toEqual({
      [due.id]: true,
      [bookedInsideWindow.id]: false,
      [tooFarAhead.id]: false,
      [cancelled.id]: false,
    });
  });

  it('sends one reminder even when several runs overlap', async () => {
    const due = await insertBooking(23, { createdDaysAgo: 3 });
    const browser = fakeBrowser('overlap');
    await post('subscribe-push', { token: due.token, subscription: browser.subscription });
    await waitFor(browser.path);
    received = [];

    const runs = await Promise.all([
      runReminders(),
      runReminders(),
      runReminders(),
      runReminders(),
    ]);
    expect(runs.every((run) => run.status === 200)).toBe(true);
    expect(runs.reduce((total, run) => total + run.body.claimed, 0)).toBe(1);

    await waitFor(browser.path);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(received).toHaveLength(1);
  });

  it('still marks a due booking as handled when it has no subscription', async () => {
    const due = await insertBooking(23, { createdDaysAgo: 3 });
    expect((await runReminders()).body).toEqual({ claimed: 1, sent: 0, failed: 0 });
    const { rows } = await db.query('select reminder_sent_at from public.bookings where id = $1', [
      due.id,
    ]);
    expect(rows[0].reminder_sent_at).not.toBeNull();
  });

  it('is wired to pg_cron through the vault secrets', async () => {
    const due = await insertBooking(23, { createdDaysAgo: 3 });
    const { rows: jobs } = await db.query(
      `select schedule, command from cron.job where jobname = 'send-reminders'`,
    );
    expect(jobs).toEqual([
      { schedule: '*/10 * * * *', command: 'select public.trigger_send_reminders()' },
    ]);

    // Run what cron runs, then wait for the database to make the HTTP call.
    await db.query('select public.trigger_send_reminders()');
    const deadline = Date.now() + 10_000;
    let reminded = false;
    while (!reminded && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const { rows } = await db.query(
        'select reminder_sent_at is not null as reminded from public.bookings where id = $1',
        [due.id],
      );
      reminded = rows[0].reminded;
    }
    expect(reminded).toBe(true);
  }, 15_000);
});

describe('barber notifications', () => {
  it('pushes new and cancelled online bookings to subscribed admins', async () => {
    const admin = fakeBrowser('admin');
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
               'push-test-admin@example.com')
       on conflict (id) do nothing`,
      [ADMIN_ID],
    );
    await db.query(
      `insert into public.push_subscriptions (endpoint, p256dh, auth, admin_user_id)
       values ($1, $2, $3, $4)`,
      [
        admin.subscription.endpoint,
        admin.subscription.keys.p256dh,
        admin.subscription.keys.auth,
        ADMIN_ID,
      ],
    );

    // Find a free slot and book it through the public API.
    let slot: string | undefined;
    for (let offset = 2; offset < 9 && !slot; offset++) {
      const date = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const response = await fetch(`${API}/get-slots?service_id=${serviceId}&date=${date}`);
      slot = ((await response.json()) as { slots: string[] }).slots[0];
    }
    const created = await post('create-booking', {
      service_id: serviceId,
      starts_at: slot,
      customer_name: 'Push Test',
      customer_phone: PHONE,
      consent: true,
    });
    expect(created.status).toBe(200);

    const [newBooking] = await waitFor(admin.path);
    expect(admin.read(newBooking!)).toMatchObject({
      title: 'Programare nouă',
      body: expect.stringMatching(/^Push Test · Tuns · .+, ora \d{2}:\d{2}$/),
      url: '/admin',
    });

    await post('cancel-booking', { token: created.body.cancel_token });
    const all = await waitFor(admin.path, 2);
    expect(all).toHaveLength(2);
    expect(admin.read(all[1]!).title).toBe('Programare anulată');
  });
});
