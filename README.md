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

| Command                 | What it does                                        |
| ----------------------- | --------------------------------------------------- |
| `npm run web`           | Start the web app in development                    |
| `npm test`              | Run unit tests (Vitest)                             |
| `npm run test:db`       | Database tests; needs `npx supabase db start` first |
| `npm run typecheck`     | TypeScript check                                    |
| `npm run lint`          | ESLint                                              |
| `npm run format`        | Format with Prettier                                |
| `npm run build:web`     | Export the static web build to `dist/`              |
| `npx supabase db reset` | Recreate the local DB from migrations and seed      |

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
