-- Initial schema for the barbershop booking app.
-- Conventions: every table has a uuid `id` and `created_at`; all instants are timestamptz (UTC).
-- Access model: RLS is enabled everywhere. `anon` has no access at all. Admins are the
-- authenticated users listed in `admins`. Customers only go through Edge Functions, which use
-- the service_role key on the server.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  singleton boolean not null default true unique check (singleton),
  shop_name text not null,
  address text not null default '',
  phone text not null default '',
  timezone text not null default 'Europe/Bucharest',
  slot_step_min integer not null default 15 check (slot_step_min between 5 and 120),
  min_notice_min integer not null default 60 check (min_notice_min >= 0),
  max_advance_days integer not null default 30 check (max_advance_days between 1 and 365),
  cancel_deadline_min integer not null default 120 check (cancel_deadline_min >= 0),
  reminder_before_min integer not null default 1440 check (reminder_before_min > 0),
  data_retention_months integer not null default 12 check (data_retention_months > 0)
);

-- ---------------------------------------------------------------------------
-- Staff (one row in the MVP; the model already supports more)
-- ---------------------------------------------------------------------------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 80),
  duration_min integer not null check (duration_min between 5 and 480),
  price_ron numeric(8, 2) not null check (price_ron >= 0),
  active boolean not null default true,
  sort_order integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Working hours. weekday: 0 = Sunday ... 6 = Saturday (same as JavaScript Date#getDay).
-- Several rows per day are allowed (lunch break). A day with no rows is closed.
-- Times are wall-clock times in settings.timezone.
-- ---------------------------------------------------------------------------
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);

create index working_hours_staff_weekday_idx on public.working_hours (staff_id, weekday);

-- ---------------------------------------------------------------------------
-- Time off (holidays, days off)
-- ---------------------------------------------------------------------------
create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);

create index time_off_staff_range_idx on public.time_off (staff_id, starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  staff_id uuid not null references public.staff (id),
  service_id uuid not null references public.services (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  customer_name text not null check (char_length(customer_name) between 1 and 80),
  -- E.164. Null only after the row has been anonymized.
  customer_phone text check (customer_phone ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled', 'completed', 'no_show')),
  cancel_token text not null unique check (char_length(cancel_token) >= 32),
  notes text check (char_length(notes) <= 500),
  source text not null default 'online' check (source in ('online', 'admin')),
  reminder_sent_at timestamptz,
  anonymized_at timestamptz,
  check (ends_at > starts_at),
  check (customer_phone is not null or anonymized_at is not null),
  -- No double bookings, guaranteed by the database. Ranges are [start, end), so
  -- back-to-back bookings are allowed.
  constraint bookings_no_overlap
    exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status = 'confirmed')
);

create index bookings_starts_at_idx on public.bookings (starts_at);
create index bookings_phone_idx on public.bookings (customer_phone) where status = 'confirmed';
create index bookings_reminder_idx on public.bookings (starts_at)
  where status = 'confirmed' and reminder_sent_at is null;

-- Writes that could collide are serialized per staff member. Without this, several
-- simultaneous inserts for the same slot wait on each other, and Postgres resolves the wait
-- as a deadlock (about one second per loser, error 40P01). With the lock, exactly one insert
-- wins and the others fail immediately with the exclusion violation (23P01).
create function public.bookings_serialize_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('bookings:' || new.staff_id::text, 0));
  return new;
end;
$$;

create trigger bookings_serialize_writes
  before insert or update of staff_id, starts_at, ends_at, status on public.bookings
  for each row execute function public.bookings_serialize_writes();

-- ---------------------------------------------------------------------------
-- Web push subscriptions: belongs either to a booking (customer) or to an admin.
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  booking_id uuid references public.bookings (id) on delete cascade,
  admin_user_id uuid references auth.users (id) on delete cascade,
  check ((booking_id is null) <> (admin_user_id is null))
);

create index push_subscriptions_booking_idx on public.push_subscriptions (booking_id);

-- ---------------------------------------------------------------------------
-- Rate limiting for Edge Functions (fixed window counters)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  key text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  unique (key, window_start)
);

-- Counts one hit for `p_key` in the current window and returns true while the caller is
-- still within `p_max` hits per window.
create function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits as rl (key, window_start)
  values (p_key, v_window)
  on conflict (key, window_start) do update set count = rl.count + 1
  returning rl.count into v_count;

  return v_count <= p_max;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
alter table public.admins enable row level security;
alter table public.settings enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.working_hours enable row level security;
alter table public.time_off enable row level security;
alter table public.bookings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.rate_limits enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.admins to authenticated;
grant select, insert, update, delete on
  public.settings, public.staff, public.services, public.working_hours, public.time_off,
  public.bookings, public.push_subscriptions
  to authenticated;
grant execute on function public.is_admin() to authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- New objects must not become readable by anon by accident.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

create policy admins_select on public.admins
  for select to authenticated using (public.is_admin());

create policy settings_admin on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_admin on public.staff
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy services_admin on public.services
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy working_hours_admin on public.working_hours
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy time_off_admin on public.time_off
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy bookings_admin on public.bookings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy push_subscriptions_admin on public.push_subscriptions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- rate_limits: no policies; only service_role (which bypasses RLS) touches it.

-- ---------------------------------------------------------------------------
-- Required rows: the app assumes exactly one settings row and at least one staff member.
-- ---------------------------------------------------------------------------
insert into public.settings (shop_name, address) values ('BarberApp', 'Târgoviște'); -- TODO: phone (PLAN.md section 12)
insert into public.staff (name) values ('Frizer'); -- TODO: real name
