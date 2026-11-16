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

| Function         | Call                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `get-services`   | `GET` - active services and public shop details                          |
| `get-slots`      | `GET ?service_id=&date=YYYY-MM-DD` - free start times (ISO, UTC)         |
| `create-booking` | `POST { service_id, starts_at, customer_name, customer_phone, consent }` |
| `get-booking`    | `GET ?token=` - the customer's own booking                               |
| `cancel-booking` | `POST { token }`                                                         |

Errors have the shape `{ "error": { "code", "message", "details"? } }`. The client maps `code` to a
Romanian text; `message` is for developers. Codes: `invalid_input` (400), `not_found` /
`service_unavailable` (404), `method_not_allowed` (405), `slot_taken`, `not_cancellable`,
`cancel_too_late` (409), `rate_limited`, `too_many_bookings` (429), `internal_error` (500).

Limits per IP: 10 requests/minute for `create-booking`, 30 for token endpoints, 120 for reads; at
most 3 upcoming confirmed bookings per phone number.

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
