# Barbearia Leme — agenda demo

Public demonstration of the **Site com Agenda** package (package 3) for Barbearia Leme. The marketing site is the same brand as [barbearia-leme](https://github.com/EstiveJobson/barbearia-leme). This repository was copied from that project with a fresh git history. The booking flow itself is rebuilt in a later change; this commit is the base: the current public site, plus a multi-shop Postgres schema and seed.

The footer of the site says **Site de demonstração**.

## Stack

- React 19 and TypeScript
- TanStack Start and TanStack Router
- Vite and Nitro (Vercel preset)
- Tailwind CSS 4
- Postgres via `pg` (Neon in production)
- Embedded [PGLite](https://pglite.dev) for local development only
- bcryptjs for owner password hashes

## Run locally (PGLite)

Requires Node.js 22.12 or newer.

```bash
git clone https://github.com/EstiveJobson/barbearia-leme-agenda.git
cd barbearia-leme-agenda
npm install
npm run dev
```

The dev server listens on `http://127.0.0.1:8080`. With `DATABASE_URL` unset, the app uses an in-memory PGLite database and applies `migrations/*.sql` on startup. The public pages still read their copy from `src/shop-config.ts`, so the site works before you seed anything.

Do not set `NODE_ENV=production` without `DATABASE_URL`. Production refuses to fall back to PGLite.

## Migrations and seed (Neon)

Point both scripts at a Neon Postgres database. Nothing in the repository is a secret; copy `.env.example` to a gitignored `.env` and fill it in locally. The scripts read the process environment (a shell export or your host's env), not a committed file.

```bash
export DATABASE_URL="postgres://user:password@host/db?sslmode=require"
export ADMIN_PASSWORD="choose-a-password"
npm run db:migrate
npm run db:seed
```

`db:migrate` applies pending files in `migrations/` inside a transaction and records them in `_migrations`. It does not apply `migrations/auth/`.

`db:seed` is idempotent. It upserts:

- **Barbearia Leme** (`slug` `barbearia-leme`, timezone `America/Bahia`) with the services, prices, durations, barbers, and weekly hours from `src/shop-config.ts`
- **Barbearia Teste** (`slug` `barbearia-teste`, timezone `America/Manaus`) with 2 barbers, 3 services, and weekly hours, used only for isolation tests

Each shop gets one `owner_accounts` row. Both password hashes are bcrypt hashes of `ADMIN_PASSWORD`. The plain password is not stored.

If `DATABASE_URL` is missing, `db:seed` exits with an error. `db:migrate` does the same when `NODE_ENV=production`.

## Data rules

- Booking times are `timestamptz` (UTC). Weekly hours are wall-clock times in `shops.timezone`.
- An active booking is unique on `(shop_id, barber_id, starts_at)`, so the same slot cannot be taken twice.
- Server queries on business tables filter by `shop_id`. That id comes from the server (the public shop slug `barbearia-leme`, or later the owner session), never from the browser.

## Environment variables

See `.env.example`. All of them are empty there on purpose.

| Variable | Role |
| --- | --- |
| `DATABASE_URL` | Neon connection string. Required in production. |
| `ADMIN_PASSWORD` | Hashed into `owner_accounts` by `db:seed`. Server-only. |
| `SESSION_SECRET` | Owner session signing secret. Server-only. |
| `RESEND_API_KEY` | Transactional email. Server-only. |
| `EMAIL_FROM` | From address for notification email. |
| `NOTIFY_EMAIL_TO` | Inbox for new-booking notifications. |
| `CRON_SECRET` | Shared secret for scheduled jobs. Server-only. |
| `DEMO_MODE` | Set to `true` on the public demo deployment. |
| `PUBLIC_SITE_URL` | Absolute origin (no trailing slash) used for `og:image` and `og:url`. |
| `VAPID_PUBLIC_KEY` | Web Push public key. |
| `VAPID_PRIVATE_KEY` | Web Push private key. Server-only. |

Server-only variables are read in server modules and seed/migrate scripts. They are not imported by browser code.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 8080 |
| `npm run build` | Production build, then `db:migrate` |
| `npm run db:migrate` | Apply `migrations/*.sql` to `DATABASE_URL` |
| `npm run db:seed` | Seed both shops against `DATABASE_URL` |
| `npm run typecheck` | TypeScript |
| `npm run preview` | Serve the production build locally |

Deployment is handled separately. This repository does not create a Vercel project.

## Layout

```
migrations/0001_agenda.sql     shops, barbers, services, weekly_schedule, blocks, bookings, owner_accounts
scripts/migrate.mjs            Neon migrator
scripts/seed.mjs               Neon seed
src/shop-config.ts             public site content (also the Leme seed source)
src/components/barbearia/      page and the current booking UI
src/lib/schedule.ts            slot labels in the shop timezone
src/lib/agenda/                UTC slot math and shop-scoped queries
src/lib/db.ts                  Neon, or PGLite when developing locally
src/routes/__root.tsx          document shell and Open Graph tags
public/                        icons and og.jpg
```

## License

[MIT](LICENSE) © 2026 Sérgio Vieira ([@EstiveJobson](https://github.com/EstiveJobson))
