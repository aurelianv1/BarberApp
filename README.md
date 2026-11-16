# BarberApp

Booking PWA for a barbershop: customers book a slot without an account, the barber manages
everything from an admin panel. See [PLAN.md](PLAN.md) for the full plan (section 14 holds the
latest decisions).

Stack: Expo (web only) + Expo Router + TypeScript, Supabase (Postgres, Auth, Edge Functions, Cron).

## Requirements

- Node 22+
- Docker (for the local Supabase stack)

## Setup

```bash
npm install
cp .env.example .env        # then fill in the anon key printed by `supabase start`
npx supabase start          # local Postgres, Auth and Edge Functions
```

## Commands

| Command                 | What it does                                            |
| ----------------------- | ------------------------------------------------------- |
| `npm run web`           | Start the web app in development                        |
| `npm test`              | Run unit tests (Vitest)                                 |
| `npm run test:db`       | Database and API tests; need `npx supabase start` first |
| `npm run typecheck`     | TypeScript check                                        |
| `npm run lint`          | ESLint                                                  |
| `npm run format`        | Format with Prettier                                    |
| `npm run build:web`     | Export the static web build to `dist/`                  |
| `npx supabase db reset` | Recreate the local DB from migrations and seed          |

## Public API (Edge Functions)

Served locally at `http://127.0.0.1:54321/functions/v1/` by `npx supabase start` (after adding or
changing a function's config, run `npx supabase functions serve`).

| Function         | Call                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| `get-services`   | `GET` - active services and public shop details                                  |
| `get-slots`      | `GET ?service_id=&date=YYYY-MM-DD` - free start times (ISO, UTC)                 |
| `create-booking` | `POST { service_id, starts_at, customer_name, customer_phone, consent }`         |
| `get-booking`    | `GET ?token=` - the customer's own booking                                       |
| `cancel-booking` | `POST { token }`                                                                 |
| `subscribe-push` | `POST { token, subscription }` - attach a browser push subscription to a booking |
| `send-reminders` | `POST` with `x-cron-secret` - called by pg_cron every 10 minutes                 |

Errors have the shape `{ "error": { "code", "message", "details"? } }`. The client maps `code` to a
Romanian text; `message` is for developers. Codes: `invalid_input` (400), `not_found` /
`service_unavailable` (404), `method_not_allowed` (405), `slot_taken`, `not_cancellable`,
`cancel_too_late` (409), `rate_limited`, `too_many_bookings` (429), `internal_error` (500).

Limits per IP: 10 requests/minute for `create-booking`, 30 for token endpoints, 120 for reads; at
most 3 upcoming confirmed bookings per phone number.

## Notifications and reminders

There is no SMS. A customer remembers a booking through:

- **Add to calendar** on the booking page (`.ics` file or Google Calendar link, with alarms 24 h
  and 2 h before and the cancellation link inside the event).
- **Web push**, if they allow it: a confirmation right away and one reminder
  `settings.reminder_before_min` before the start. On iPhone this only works after the app is
  added to the Home Screen.
- **The browser itself**: bookings made on a device are listed on the home page (localStorage).

The barber gets a push for every new or cancelled online booking once an admin device is
subscribed (admin panel, phase 5).

How reminders run: pg_cron calls `public.trigger_send_reminders()` every 10 minutes, which POSTs
to the `send-reminders` function. The function asks the database for due bookings with
`claim_due_reminders()`, which marks and returns them in one statement, so a reminder is sent at
most once even if runs overlap. Bookings made inside the reminder window get no reminder.

Setup per environment:

```bash
npm run vapid:generate                       # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
npx supabase secrets set CRON_SECRET=... VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
```

Put the public key in the client as `EXPO_PUBLIC_VAPID_PUBLIC_KEY`, then store the function URL
and the same cron secret in Vault (SQL editor):

```sql
select vault.create_secret('https://<project>.supabase.co/functions/v1', 'functions_base_url');
select vault.create_secret('<CRON_SECRET>', 'cron_secret');
```

Locally these are already set by `supabase/seed.sql` and `supabase/functions/.env` (copy it from
`supabase/functions/.env.example`).

## Layout

```
app/                  routes (Expo Router)
src/texts/ro.ts       all UI strings (Romanian)
src/                  non-route client code
supabase/migrations/  database migrations
supabase/functions/   Edge Functions (Deno)
```

## Secrets

Only `EXPO_PUBLIC_*` values go in `.env`. The `service_role` key and other server secrets are set
with `npx supabase secrets set` and never appear in client code or in this repo.
