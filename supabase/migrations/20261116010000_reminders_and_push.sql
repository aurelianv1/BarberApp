-- Reminders (pg_cron -> send-reminders Edge Function) and web push subscriptions.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- One browser may hold several bookings (and an admin session), so the same endpoint can
-- appear once per owner instead of once overall.
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions drop constraint push_subscriptions_endpoint_key;
alter table public.push_subscriptions
  add constraint push_subscriptions_owner_key
  unique nulls not distinct (endpoint, booking_id, admin_user_id);

create index push_subscriptions_admin_idx on public.push_subscriptions (admin_user_id)
  where admin_user_id is not null;

-- ---------------------------------------------------------------------------
-- Claims the bookings whose reminder is due and returns them.
--
-- The claim (setting reminder_sent_at) happens in the same statement that selects the rows,
-- so two overlapping runs can never both get the same booking: a reminder is sent at most
-- once. A booking made inside the reminder window gets no reminder, because the customer
-- has just seen the confirmation.
-- ---------------------------------------------------------------------------
create function public.claim_due_reminders()
returns table (booking_id uuid, starts_at timestamptz, service_name text, cancel_token text)
language sql
security definer
set search_path = ''
as $$
  with cfg as (
    select make_interval(mins => reminder_before_min) as lead from public.settings limit 1
  ),
  claimed as (
    update public.bookings b
    set reminder_sent_at = now()
    from cfg
    where b.status = 'confirmed'
      and b.reminder_sent_at is null
      and b.starts_at > now()
      and b.starts_at <= now() + cfg.lead
      and b.created_at <= b.starts_at - cfg.lead
    returning b.id, b.starts_at, b.service_id, b.cancel_token
  )
  select c.id, c.starts_at, s.name, c.cancel_token
  from claimed c
  join public.services s on s.id = c.service_id;
$$;

-- ---------------------------------------------------------------------------
-- Cron -> Edge Function. The function URL and the shared secret differ per environment,
-- so they live in Supabase Vault rather than in this file:
--   select vault.create_secret('https://<project>.supabase.co/functions/v1', 'functions_base_url');
--   select vault.create_secret('<same value as the CRON_SECRET function secret>', 'cron_secret');
-- ---------------------------------------------------------------------------
create function public.trigger_send_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';

  if v_url is null or v_secret is null then
    raise warning 'send-reminders skipped: vault secrets functions_base_url / cron_secret are not set';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function public.claim_due_reminders() from public, anon, authenticated;
revoke all on function public.trigger_send_reminders() from public, anon, authenticated;
grant execute on function public.claim_due_reminders() to service_role;

select cron.schedule('send-reminders', '*/10 * * * *', $$select public.trigger_send_reminders()$$);

-- Housekeeping: rate limit counters are only useful for the current window.
select cron.schedule(
  'prune-rate-limits',
  '17 3 * * *',
  $$delete from public.rate_limits where window_start < now() - interval '1 day'$$
);
