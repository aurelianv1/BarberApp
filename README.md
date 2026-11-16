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
cp .env.example .env        # then fill in the anon key printed by `npx supabase status`
npx supabase start          # local Postgres, Auth and Edge Functions
```

## Admin account

Public sign-up is disabled (`enable_signup = false`); the barber's account is created from the
command line and listed in the `admins` table, which is what Row Level Security checks.

```bash
# Local: take the two values from `npx supabase status`
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
  npm run admin:create -- admin@example.com 'a-long-password'
```

Then sign in at `/admin/login`. For production use the project's URL and service_role key from
the Supabase dashboard; the key is only read from the environment for this one command.

The admin panel (`/admin`): day agenda, week view, booking details and status, manual bookings
(phone number optional), services, working hours, days off, settings, and push notifications
for the barber's device.

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

## PWA

- `public/manifest.json`, icons in `public/icons/` (placeholder artwork: replace with the real
  logo, keeping the file names and sizes), iOS tags in `public/index.html`.
- `public/sw.js`: offline page for page loads, cache for the hashed build files and the icons,
  push notifications. API responses are never cached. Bump `VERSION` in the file when the
  cached shell files change.
- The home page invites visitors to install the app: instructions on iPhone (Safari: Share,
  then "Add to Home Screen"), an install button on Android/Chrome.

## Privacy (GDPR)

- Explicit consent checkbox when booking; privacy policy at `/privacy`. **Before launch, fill in
  the operator details marked `[...]` in `src/texts/ro.ts` and have the text reviewed.**
- Customer data is anonymized automatically `settings.data_retention_months` (12) after the
  appointment, by a daily cron job (`anonymize_old_bookings`).
- The barber can erase a customer from a booking's page in the admin panel: it clears the name,
  phone and notes from all bookings with that phone number and cancels upcoming ones.
- Booking links hold a secret token, so pages are served with `Referrer-Policy: no-referrer`
  and `/booking/*` and `/admin/*` are marked `noindex`.

## Deployment

1. **Supabase project** (production):
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push                       # runs the migrations
   npx supabase functions deploy              # deploys all Edge Functions
   npm run vapid:generate
   npx supabase secrets set CRON_SECRET=<random> VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
     VAPID_SUBJECT=mailto:<you> ALLOWED_ORIGINS=https://<domain>
   ```
   In the dashboard: disable sign-ups (Authentication settings), then in the SQL editor create
   the two Vault secrets from "Notifications and reminders", and insert the real services and
   working hours (or add them from the admin panel). Create the admin with `npm run admin:create`.
2. **Hosting**: any static host works. Config is included for Render (`render.yaml`, a
   Blueprint: New > Blueprint in the dashboard) and Vercel (`vercel.json`); both hold the SPA
   rewrite and security headers. Set
   `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_VAPID_PUBLIC_KEY`
   as environment variables, then deploy. Point the domain at it.
3. Go through the QA checklist in `PLAN.md` section 11 on a real iPhone and Android phone.

Note: `supabase/config.toml` applies to the local stack; hosted auth settings (sign-ups off,
password length) are set in the dashboard or with `npx supabase config push`.

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
