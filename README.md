# Barbearia Leme — agenda demo

Public demonstration of the **Site com Agenda** package (package 3) for Barbearia Leme. The marketing site is the same brand as [barbearia-leme](https://github.com/EstiveJobson/barbearia-leme). Customers book a real slot: the server checks the shop's hours, active bookings, and blocks, then saves the row.

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

The dev server listens on `http://127.0.0.1:8080`. With `DATABASE_URL` unset, the app uses an in-memory PGLite database, applies `migrations/*.sql`, and seeds Barbearia Leme plus the fictional test shop so the public booking flow works. Set `ADMIN_PASSWORD` first if you also want local owner hashes.

Do not set `NODE_ENV=production` without `DATABASE_URL`. Production refuses to fall back to PGLite.

## Migrations and seed

`db:migrate` targets Neon when `DATABASE_URL` is set. `db:seed` uses that database, or an in-memory PGLite fallback when it is not. Nothing in the repository is a secret; copy `.env.example` to a gitignored `.env` and fill it in locally. The scripts read the process environment (a shell export or your host's env), not a committed file.

```bash
export DATABASE_URL="postgres://user:password@host/db?sslmode=require"
export ADMIN_PASSWORD="choose-a-password"
npm run db:migrate
npm run db:seed
```

`db:migrate` applies pending files in `migrations/` inside a transaction and records them in `_migrations`. It does not apply `migrations/auth/`.

`db:seed` is idempotent. It upserts:

- **Barbearia Leme** (`slug` `barbearia-leme`, timezone `America/Bahia`) with the services, prices, durations, barbers, and weekly hours from `src/shop-config.ts`
- **Barbearia Teste** (`slug` `barbearia-teste`, timezone `America/Manaus`) with 2 barbers, 3 services, and weekly hours, used only for isolation tests. It has no WhatsApp number, so the missing-number path can be checked without touching Leme.

Each shop gets one `owner_accounts` row. Leme's password hash is bcrypt of `ADMIN_PASSWORD`. The test shop uses `TEST_SHOP_PASSWORD` when that variable is set; otherwise `db:seed` generates a random password and prints it once. Plain passwords are not stored. Re-seeding a password increments `session_version`, so older panel cookies stop working. Both shops are marked `is_demo`. When `DEMO_MODE=true`, a demo shop that has no bookings yet also receives a sample agenda. Existing bookings are not deleted.

If `DATABASE_URL` is set, `db:seed` writes to that Postgres database. If it is missing, the same upsert runs against an in-memory PGLite database after applying `migrations/*.sql`. `ADMIN_PASSWORD` is required in both cases. `db:migrate` exits with an error when `NODE_ENV=production` and `DATABASE_URL` is missing.

## Data rules

- Booking times are `timestamptz` (UTC). Weekly hours are wall-clock times in `shops.timezone`.
- An active booking is unique on `(shop_id, barber_id, starts_at)`, so the same slot cannot be taken twice.
- Server queries on business tables filter by `shop_id`. That id comes from the server (the public shop slug `barbearia-leme`, or later the owner session), never from the browser.
- Shop WhatsApp links are built on the server from `shops.whatsapp` (digits with DDD, no country code). A shop with no number does not get a fallback: the booking is still saved, the success screen explains that, and the site hides the WhatsApp buttons.
- Confirm attempts are counted in `rate_limits`: 8 per 10-minute window. The key is the route name plus a SHA-256 of the IP, so the raw address is not stored. Over the limit the confirm responds with HTTP 429.

## Environment variables

See `.env.example`. All of them are empty there on purpose.

| Variable | Role |
| --- | --- |
| `DATABASE_URL` | Neon connection string. Required in production. |
| `ADMIN_PASSWORD` | Hashed into Leme's `owner_accounts` row by `db:seed`. Server-only. |
| `TEST_SHOP_PASSWORD` | Optional. Password for the `barbearia-teste` owner. If unset, `db:seed` generates one and prints it once. |
| `SESSION_SECRET` | Owner session signing secret. Server-only. |
| `RESEND_API_KEY` | Resend API key. Server-only. Required to email new bookings. |
| `EMAIL_FROM` | From address for that email. |
| `NOTIFY_EMAIL_TO` | Inbox that receives new-booking emails. |
| `CRON_SECRET` | Shared secret for scheduled jobs. Server-only. |
| `DEMO_MODE` | Set to `true` on the public demo deployment. |
| `PUBLIC_SITE_URL` | Absolute origin (no trailing slash) used for `og:image`, `og:url`, and the panel link in the booking email. |
| `VAPID_PUBLIC_KEY` | Web Push public key. Safe to expose. Both VAPID keys are required for push. |
| `VAPID_PRIVATE_KEY` | Web Push private key. Server-only. |

Server-only variables are read in server modules and seed/migrate scripts. They are not imported by browser code.

## Owner panel

`/painel/entrar?loja=<slug>` asks for that shop's owner password. If `loja` is omitted, the screen sends Leme's slug; the server does not pick a shop on its own. It loads only that shop's bcrypt hash. A wrong shop or a wrong password both return "Senha ou loja incorreta." A correct password sets an httpOnly cookie signed with `SESSION_SECRET` (30 days). The cookie stores the owner account id and `session_version`. Every panel request loads `shop_id` from that row and rejects the cookie when `session_version` does not match. Every panel query ignores any shop id sent by the browser.

Set `ADMIN_PASSWORD` before the first local seed so an owner row exists, and set `SESSION_SECRET` before opening the panel. "Sair" clears the cookie. Login attempts are rate-limited per IP in `rate_limits`.

## Notifications

After a booking is committed, the server emails `NOTIFY_EMAIL_TO` through Resend. The message is in Portuguese. The subject is `Novo agendamento: [serviço] em [dd/mm] às [hh:mm]`, and the body includes the customer, service, barber, day, time, price, and a link to `PUBLIC_SITE_URL/painel`. If `RESEND_API_KEY`, `EMAIL_FROM`, or `NOTIFY_EMAIL_TO` is missing, the email is skipped. A failed send is logged without the API key. The booking stays saved and the customer still sees success.

When both VAPID keys are set, and demo mode is off, the panel shows **Ativar avisos**. That stores the browser subscription in `push_subscriptions` for the session shop, and each new booking pushes `Novo agendamento: [serviço], [dd/mm] [hh:mm], [nome]` to that shop. Subscriptions that the push service reports as expired (HTTP 404 or 410) are deleted. If either VAPID key is missing, the button stays hidden. In demo mode push is disabled: the button is replaced by a notice, the push endpoints refuse the request, and no push is sent.

## Demo mode

Demo mode stays off unless `DEMO_MODE` is exactly `true`. The server checks that value. It is not a query parameter. Demo-only behavior also requires `shops.is_demo`. A slug or id is never treated as a demo allowlist.

When both are true for a shop:

- `/painel/entrar?loja=<slug>` shows **Entrar como dono (demo)** for that shop only. The button signs in with no password, and only if that shop has `is_demo`. The same action returns 404 when demo mode is off or the shop is not a demo shop.
- The public site shows **Demonstração** when the public shop is a demo shop. The panel shows it for the signed-in shop. The login screen shows it for the shop in `loja`.
- Sample bookings are created by `db:seed` (only for demo shops that have no bookings, and only when `DEMO_MODE=true`) and by the nightly reset. A running process may fill a missing sample at most once, in memory, with no global lock and no count on later requests.
- Push stays off for that shop. The panel hides **Ativar avisos** and shows **Avisos desativados na demonstração.** The endpoints that return the VAPID public key and that save a subscription respond `403` with `{ "error": "Avisos desativados na demonstração." }` and store nothing. A request with no session is `401` even in demo mode. Email still goes out. Push is not sent for that shop, including to subscriptions already in the database.
- `GET /api/demo/reset` deletes bookings, blocks, and push subscriptions for every shop with `is_demo`, then reloads each of those shops' sample for the current day. Shops with `is_demo = false` are left untouched. Services, barbers, hours, and owner accounts are left as they are. The route returns 404 when demo mode is off. When it is on, the request must send `Authorization: Bearer <CRON_SECRET>`. Anything else is 401. POST and every other method return 405 with an `Allow: GET` header.

Sample rows are inserted directly. They do not send the new-booking email or push.

`vercel.json` schedules that route every night at 03:00 in Bahia (`0 6 * * *`, 06:00 UTC). Set `CRON_SECRET` on the host so Vercel Cron can send the bearer token.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 8080 |
| `npm run build` | Production build, then `db:migrate` |
| `npm run db:migrate` | Apply `migrations/*.sql` to `DATABASE_URL` |
| `npm run db:seed` | Seed both shops against `DATABASE_URL`, or PGLite when it is unset |
| `npm run typecheck` | TypeScript |
| `npm run preview` | Serve the production build locally |

## Deployment

This repository does not create a Vercel project. Configure these environment variables on the host you choose:

- `DATABASE_URL`: the Neon Postgres connection string. Required in production. Without it, production refuses to start.
- `ADMIN_PASSWORD`: Leme's owner password. `db:seed` stores a bcrypt hash in `owner_accounts`. Server-only.
- `TEST_SHOP_PASSWORD`: optional password for the test shop owner. If unset, `db:seed` generates one and prints it once.
- `SESSION_SECRET`: a long random string that signs the owner session cookie. Server-only.
- `RESEND_API_KEY` and `EMAIL_FROM`: for the booking notification email. If either is missing, the email is skipped.
- `NOTIFY_EMAIL_TO`: the inbox that receives new-booking notifications, including on the public demo.
- `CRON_SECRET`: protects `GET /api/demo/reset`. Server-only.
- `DEMO_MODE=true`: turns demo mode on. Any other value leaves it off.
- `PUBLIC_SITE_URL`: the public URL of the site, with no trailing slash. Used for `og:image`, `og:url`, and the panel link in the booking email.
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`: only if push was implemented. Both are required before the panel shows **Ativar avisos**. The private key stays on the server.

Copy `.env.example` for the names. Do not commit real values. The only env file in the repo is `.env.example`.

## Layout

```
migrations/0001_agenda.sql     shops, barbers, services, weekly_schedule, blocks, bookings, owner_accounts
migrations/0002_rate_limits.sql confirm and login rate-limit windows
migrations/0003_block_reason.sql optional reason on a block
migrations/0004_push_subscriptions.sql owner Web Push subscriptions
scripts/migrate.mjs            Neon migrator
scripts/seed.ts               Neon or local PGLite seed
src/shop-config.ts             public site content (also the Leme seed source)
src/components/barbearia/      page and the current booking UI
src/lib/schedule.ts            slot labels in the shop timezone
src/lib/agenda/                UTC slot math and shop-scoped queries
src/lib/demo/                 sample agenda and the daily reset
src/lib/db.ts                  Neon, or PGLite when developing locally
src/routes/__root.tsx          document shell and Open Graph tags
public/                        icons and og.jpg
```

## License

[MIT](LICENSE) © 2026 Sérgio Vieira ([@EstiveJobson](https://github.com/EstiveJobson))
