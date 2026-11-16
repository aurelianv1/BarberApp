import { randomBytes } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Database guarantees, run against the local Supabase Postgres.
 * Start it with `npx supabase db start`, then `npm run test:db`.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const EXCLUSION_VIOLATION = '23P01';
const INSUFFICIENT_PRIVILEGE = '42501';

let a: pg.Client;
let b: pg.Client;
let staffId: string;
let serviceId: string;

const token = () => randomBytes(24).toString('hex');

// Far in the future so test rows never collide with seed or manual data.
const T = (time: string) => `2099-06-01T${time}:00Z`;

const INSERT = `
  insert into public.bookings
    (staff_id, service_id, starts_at, ends_at, customer_name, customer_phone, cancel_token, notes)
  values ($1, $2, $3, $4, 'Test Client', '+40700000001', $5, 'db-test')
  returning id`;

const insert = (client: pg.Client, start: string, end: string) =>
  client.query(INSERT, [staffId, serviceId, T(start), T(end), token()]);

beforeAll(async () => {
  a = new pg.Client({ connectionString: DATABASE_URL });
  b = new pg.Client({ connectionString: DATABASE_URL });
  await Promise.all([a.connect(), b.connect()]);

  staffId = (await a.query('select id from public.staff limit 1')).rows[0].id;
  serviceId = (
    await a.query(
      `insert into public.services (name, duration_min, price_ron, active)
       values ('db-test service', 30, 1, false) returning id`,
    )
  ).rows[0].id;
});

beforeEach(async () => {
  await a.query(`delete from public.bookings where notes = 'db-test'`);
});

afterAll(async () => {
  await a.query(`delete from public.bookings where notes = 'db-test'`);
  await a.query(`delete from public.services where id = $1`, [serviceId]);
  await Promise.all([a.end(), b.end()]);
});

describe('bookings_no_overlap', () => {
  it('lets only one of two concurrent inserts for the same interval succeed', async () => {
    // Both transactions insert the same slot before either commits.
    await a.query('begin');
    await b.query('begin');
    await insert(a, '10:00', '10:30');

    // B has to wait for A's transaction, then fails once A commits.
    const second = insert(b, '10:00', '10:30').then(
      () => 'inserted',
      (error: pg.DatabaseError) => error,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await a.query('commit');

    const result = await second;
    await b.query('rollback');

    expect(result).toBeInstanceOf(Error);
    expect((result as pg.DatabaseError).code).toBe(EXCLUSION_VIOLATION);
    expect((result as pg.DatabaseError).constraint).toBe('bookings_no_overlap');

    const { rows } = await a.query(
      `select count(*)::int as n from public.bookings where notes = 'db-test'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('never stores more than one booking when many requests race', async () => {
    const clients = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const client = new pg.Client({ connectionString: DATABASE_URL });
        await client.connect();
        return client;
      }),
    );
    try {
      const startedAt = Date.now();
      const results = await Promise.allSettled(
        clients.map((client) => insert(client, '11:00', '11:30')),
      );
      const ok = results.filter((result) => result.status === 'fulfilled');
      const failed = results.filter((result) => result.status === 'rejected');

      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(7);
      // Losers must fail fast with the constraint error, not after a deadlock timeout.
      expect(Date.now() - startedAt).toBeLessThan(900);
      for (const failure of failed) {
        expect((failure.reason as pg.DatabaseError).code).toBe(EXCLUSION_VIOLATION);
      }
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it('rejects partial overlaps', async () => {
    await insert(a, '10:00', '10:30');
    await expect(insert(a, '10:15', '10:45')).rejects.toMatchObject({ code: EXCLUSION_VIOLATION });
    await expect(insert(a, '09:45', '10:15')).rejects.toMatchObject({ code: EXCLUSION_VIOLATION });
  });

  it('allows back-to-back bookings', async () => {
    await insert(a, '10:00', '10:30');
    await expect(insert(a, '10:30', '11:00')).resolves.toBeDefined();
    await expect(insert(a, '09:30', '10:00')).resolves.toBeDefined();
  });

  it('frees the interval once a booking is cancelled', async () => {
    const { rows } = await insert(a, '10:00', '10:30');
    await a.query(`update public.bookings set status = 'cancelled' where id = $1`, [rows[0].id]);
    await expect(insert(a, '10:00', '10:30')).resolves.toBeDefined();
  });
});

describe('booking column checks', () => {
  it('rejects a short cancel token and a malformed phone number', async () => {
    await expect(
      a.query(INSERT, [staffId, serviceId, T('12:00'), T('12:30'), 'short']),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      a.query(
        `insert into public.bookings
           (staff_id, service_id, starts_at, ends_at, customer_name, customer_phone, cancel_token, notes)
         values ($1, $2, $3, $4, 'Test Client', '0712345678', $5, 'db-test')`,
        [staffId, serviceId, T('12:00'), T('12:30'), token()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('phone number requirement', () => {
  const insertWithoutPhone = (source: string) =>
    a.query(
      `insert into public.bookings
         (staff_id, service_id, starts_at, ends_at, customer_name, cancel_token, notes, source)
       values ($1, $2, $3, $4, 'Walk In', $5, 'db-test', $6)`,
      [staffId, serviceId, T('14:00'), T('14:30'), token(), source],
    );

  it('lets the barber add a booking without a phone number', async () => {
    await expect(insertWithoutPhone('admin')).resolves.toBeDefined();
  });

  it('still requires a phone number for online bookings', async () => {
    await expect(insertWithoutPhone('online')).rejects.toMatchObject({
      code: '23514',
      constraint: 'bookings_phone_required',
    });
  });
});

describe('access control', () => {
  const tables = [
    'admins',
    'settings',
    'staff',
    'services',
    'working_hours',
    'time_off',
    'bookings',
    'push_subscriptions',
    'rate_limits',
  ];

  it('has RLS enabled on every public table', async () => {
    const { rows } = await a.query(
      `select relname from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it.each(tables)('denies anon any access to %s', async (table) => {
    await a.query('begin');
    try {
      await a.query('set local role anon');
      await expect(a.query(`select * from public.${table} limit 1`)).rejects.toMatchObject({
        code: INSUFFICIENT_PRIVILEGE,
      });
    } finally {
      await a.query('rollback');
    }
  });

  it('shows an authenticated non-admin no rows and blocks their writes', async () => {
    await a.query('begin');
    try {
      await a.query('set local role authenticated');
      await a.query(
        `select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true)`,
      );
      expect((await a.query('select * from public.bookings')).rows).toEqual([]);
      expect((await a.query('select * from public.settings')).rows).toEqual([]);
      await expect(
        a.query(`insert into public.services (name, duration_min, price_ron) values ('x', 30, 1)`),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
    } finally {
      await a.query('rollback');
    }
  });

  it('gives an admin full access', async () => {
    const userId = '00000000-0000-0000-0000-0000000000aa';
    await a.query('begin');
    try {
      await a.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'db-test-admin@example.com')`,
        [userId],
      );
      await a.query('insert into public.admins (user_id) values ($1)', [userId]);
      await a.query('set local role authenticated');
      await a.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: 'authenticated' }),
      ]);

      expect((await a.query('select * from public.settings')).rows).toHaveLength(1);
      const inserted = await a.query(
        `insert into public.services (name, duration_min, price_ron) values ('admin svc', 30, 1) returning id`,
      );
      expect(inserted.rows).toHaveLength(1);
    } finally {
      await a.query('rollback');
    }
  });
});

describe('check_rate_limit', () => {
  it('allows up to the limit within a window, then refuses', async () => {
    const key = `db-test:${token()}`;
    const call = async () =>
      (await a.query('select public.check_rate_limit($1, 3, 3600) as ok', [key])).rows[0].ok;

    expect([await call(), await call(), await call()]).toEqual([true, true, true]);
    expect(await call()).toBe(false);

    await a.query('delete from public.rate_limits where key = $1', [key]);
  });
});
