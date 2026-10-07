# projectname-api

Multi-vendor marketplace API — Node + Express + TypeScript + Prisma +
PostgreSQL + Redis. Backend only; the web, Android and iOS apps consume it.

This file is the operational README: how to run it, how to test it, how to
deploy it.

| Document | What it holds |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | What the API does — the stack, the modules, the endpoints, every configuration value |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | The rules code here must follow — envelope, key ordering, naming, DO's and DON'Ts |
| [`AGENTS.md`](AGENTS.md) | Orientation for AI agents working in this repo |
| `GET /api/v1/docs.json` | The endpoint contract, generated from the live router |

---

## Requirements

- Node.js 20+ (`.nvmrc` pins 22)
- A PostgreSQL database
- Optional: Redis — background jobs and realtime analytics need it

---

## First run

```bash
npm install
npm run prisma:generate
npm run env:sync      # .env.example is generated from .env — copy it if you need a clean one
npm run db:migrate    # create the schema
npm run seed          # settings, SUPER_ADMIN, permission matrix, demo data
npm run dev
```

The API is then on <http://localhost:5000/api/v1>.

---

## Commands

### Clean install

Start from zero, the way a new machine would.

```powershell
# Windows PowerShell
Remove-Item -Recurse -Force node_modules, package-lock.json
npm cache clean --force
npm install
npm run prisma:generate
```

```bash
# macOS / Linux
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
npm run prisma:generate
```

`npm run clean` is the lighter option — it drops build output and caches but
keeps `node_modules`, so a rebuild is fast.

### Everyday

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with hot reload |
| `npm run build` | `prisma generate` + `tsc -p tsconfig.build.json` → `dist/` |
| `npm start` | Run the compiled server |
| `npm run clean` | Delete `dist/`, `coverage/`, `uploads/tmp/`, caches |
| `npm run prisma:generate` | Generate the Prisma client — needed after every install |
| `npm run prisma:studio` | Browse data in a GUI |
| `npm run prisma:diff` | Print the SQL for the current schema |
| `npx prisma migrate deploy` | Apply pending migrations |
| `npm run seed` | Idempotent seed — settings, RBAC, SUPER_ADMIN, demo data |

### Database

| Command | What it does |
| --- | --- |
| `npm run db:up` | Start a local PGlite PostgreSQL (no install needed) |
| `npm run db:status` | Is it up? |
| `npm run db:restart` | Bounce it — needed between e2e runs |
| `npm run db:migrate` | Apply migrations to the local database |
| `npm run db:down` | Stop it |
| `npm run db:check` | Summarise what the seed produced |
| `npm run db:reset` | Drop, recreate, migrate, seed — **dev only** |

> `db:reset` refuses to touch a remote host or a production database. It is the
> command for when development is finished and you want a clean slate.

### Verifying

| Command | What it does |
| --- | --- |
| `npm run env:check` | Fail if `.env` and `.env.example` have drifted |
| `npm run env:sync` | Regenerate `.env.example` from `.env` |
| `npm run comments:check` | Fail if a comment breaks the comment structure |
| `npm run comments:fix` | Rewrite multi-line `//` prose into doc blocks |
| `npm run doctor` | Is the database alive? Is any secret weak or exposed? |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm test` | Unit + contract tests (no database needed) |
| `npm run test:watch` / `test:coverage` | Watch mode / coverage |
| `npm run verify` | **The gate:** `env:check` + `typecheck` + `lint` + `test` |

### Environment

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # new secret
```

`.env` is split into two parts: **required** (the app throws without them) and
**optional** (each states its default in a comment, so a fresh clone runs without
reading the code).

### Simulating the production build

Run exactly what Render runs:

```bash
npm ci --include=dev && npx prisma generate && npx prisma migrate deploy && npm run seed && npm run build
```

`--include=dev` is required: `NODE_ENV=production` makes npm omit
devDependencies, and `prisma`, `typescript` and `tsx` all live there. Do **not**
add `--ignore-scripts` — bcrypt fetches its native binary in an install script.

Then boot the compiled output in production mode:

```powershell
# Windows PowerShell
$env:NODE_ENV="production"; npm start
```

```bash
# macOS / Linux
NODE_ENV=production npm start
```

This exercises the production env rules: strict CORS, no OTP codes in logs, and
a refusal to boot if `OTP_STATIC_CODE` is set or a delivery provider is missing.

---

## Database

There are three supported ways to get one. Migrations are a single
`20260101000000_init` folder holding the full schema, so any of them can be
built from scratch with `npx prisma migrate deploy && npm run seed`.

### Option A — Render Postgres (current setup)

The dashboard shows two URLs, and which one you need depends on where the code
is running.

| URL | Resolves from | Use for |
| --- | --- | --- |
| Internal | inside Render only | your deployed Web Service |
| External | anywhere, incl. your laptop | local dev + running tests |

```
DATABASE_URL="postgresql://USER:PASS@dpg-xxxx.<region>-postgres.render.com:5432/DB?schema=public&connection_limit=5"
```

Keep `PGLITE_MODE=false`. The internal hostname only resolves inside Render's
private network, which is why a local setup fails with a misleading
"database does not exist" if you use it.

### Option B — Docker (closest to a self-hosted production box)

```bash
docker compose up -d
npm run db:migrate
npm run seed
```

### Option C — no Docker, PGlite (Windows-friendly fallback)

```bash
npm run db:up
npm run db:migrate
npm run seed
```

PGlite is genuine PostgreSQL compiled to WebAssembly, so the same SQL,
constraints and migrations run. It exists because a normal `postgres.exe` cannot
start on some Windows machines where antivirus blocks child-process creation
(backends die with `STATUS_DLL_INIT_FAILED` / `0xC0000142`).

Two settings are required, and both must be **removed** when you point at a real
PostgreSQL server:

```
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres?pgbouncer=true&connection_limit=1"
PGLITE_MODE=true
```

- `pgbouncer=true` — the bridge reuses one connection, so named prepared
  statements collide with `42P05 already exists`. This disables them.
- `connection_limit=1` — caps the pool at that single connection.
- `PGLITE_MODE=true` — serialises Prisma queries so overlapping calls do not
  trip over the single connection. No-op against a real server.

**PGlite serves one client at a time**, so restart it between e2e runs. That is
also why `prisma migrate dev` does not work against it — it needs a concurrent
shadow database. Use `npm run db:migrate` locally and
`npx prisma migrate deploy` in CI and production.

---

## Redis

Optional. With `REDIS_URL` empty the API still runs — caching is skipped, jobs
are dropped and rate limiting falls back to per-instance counters. Jobs and
realtime analytics need it:

```bash
QUEUE_ENABLED=true
WORKER_ENABLED=true
```

`QUEUE_ENABLED=true` without a `REDIS_URL` is a boot error, so set one or the
other.

---

## Environment variables

Full inventory in `src/config/env.config.ts` — a Zod schema validated before the
server starts. Required ones have no default and a missing value stops the boot.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Internal URL on Render, external URL locally |
| `JWT_ACCESS_SECRET` | ✅ | ≥16 chars. Changing it logs everyone out |
| `JWT_REFRESH_SECRET` | ✅ | ≥16 chars, must differ from the access secret |
| `NODE_ENV` | | Default `development`. **Set `production` on Render** — without it CORS allows every origin with credentials |
| `CORS_ORIGINS` | | Comma-separated, no wildcard. Empty in production ⇒ all browser origins rejected |
| `SOCKET_CORS_ORIGINS` | | Falls back to `CORS_ORIGINS` |
| `PORT` / `APP_NAME` / `LOG_LEVEL` | | Defaults `5000` / `projectname` / `info` |
| `JWT_ACCESS_EXPIRY` / `JWT_REFRESH_EXPIRY` | | Defaults `15m` / `7d` |
| `REDIS_URL` | | Required while `QUEUE_ENABLED=true` |
| `QUEUE_ENABLED` / `WORKER_ENABLED` / `QUEUE_PREFIX` | | `true` / `true` / `projectname` |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | | The default password must never reach production |
| `TRACKING_ENABLED` | | Default `true` — 2 extra DB queries per request |
| `RATE_LIMIT_ENABLED` | | Default `true`. `false` also removes the OTP brute-force guard |
| `CLOUDINARY_*` | | Without them upload routes return 503. Use the account-level **Root** key |
| `BREVO_*` / `SMTP_*` / `MAIL_FROM_*` | | Optional. With none set, OTP mail is dropped into the log |
| `MSG91_*` / `OTP_SMS_ENABLED` | | SMS. In India a DLT sender and template id are mandatory |
| `OTP_REQUIRED` | | Default `true`. See [OTP](#otp) |
| `OTP_STATIC_CODE` | | **Must be empty in production.** Digits-only fixed code for local work |
| `ENCRYPTION_ENABLED` / `ENCRYPTION_KEY` | | Key must be exactly 64 hex chars when enabled |

Rules that are enforced at boot, whichever combination you set:

| Condition | Result |
| --- | --- |
| `QUEUE_ENABLED=true` + no `REDIS_URL` | boot error |
| `ENCRYPTION_ENABLED=true` + key not 64 hex | boot error |
| production + `*` in `CORS_ORIGINS` | boot error |
| `OTP_STATIC_CODE` set in production | boot error |
| production + `OTP_REQUIRED=true` + no delivery provider | boot error |

---

## Running locally

```bash
npm run dev     # watch mode
npm run build   # compile to dist/
npm start       # run the compiled output
```

### Health check

```bash
curl http://localhost:5000/api/v1/health
curl http://localhost:5000/api/v1/health/db
curl http://localhost:5000/api/v1/health/redis
curl http://localhost:5000/api/v1/health/queue
```

`/health` never touches the database, so it stays green even when Postgres is
down — that is deliberate for uptime probes. Use `/health/db` to check the data
layer.

### Registering an account

With the default `.env`, `OTP_STATIC_CODE=111111` and the code is printed in the
server log instead of being emailed.

```bash
# 1. request the code
curl -X POST http://localhost:5000/api/v1/auth/register/sendOtp \
  -H "Content-Type: application/json" -H "x-device-id: dev" \
  -d '{"identifier":"you@example.com"}'

# 2. verify the code — returns a single-use verificationToken
curl -X POST http://localhost:5000/api/v1/auth/register/verifyOtp \
  -H "Content-Type: application/json" -H "x-device-id: dev" \
  -d '{"identifier":"you@example.com","otp":"111111"}'

# 3. register with the token
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" -H "x-device-id: dev" \
  -d '{"type":"CUSTOMER","name":"Your Name","email":"you@example.com","password":"Aa1!aaaa","verificationToken":"<from step 2>"}'
```

OTP login is the same shape in two steps: `POST /auth/sendOtp` with
`{"type":"LOGIN"}`, then `POST /auth/login/verifyOtp` with the code, which
verifies it and signs in in one call.

To skip the code while building, set `OTP_REQUIRED=false`. Do not ship that.

---

## Testing

```bash
npm run verify     # the gate: env:check + typecheck + lint + test
npm test           # unit + contract, no database needed
npm run e2e        # live HTTP suites against a real database
```

The live suites drive the real Express app through supertest against a live
PostgreSQL database, so they assert behaviour rather than mocks. Every response
is checked against the strict envelope (`status` / `message` / `result`, no `null`
at any depth), and role boundaries are asserted explicitly.

| Suite | Covers |
| --- | --- |
| `e2e-smoke.ts` | auth: register / login / refresh / logout / RBAC |
| `e2e-user-vendor.ts` | profile, addresses, KYC, vendor approval, payout request |
| `e2e-product.ts` | catalogue CRUD, variants, images, stock, recommendations |
| `e2e-catalog.ts` | brands, tags, attributes, collections, categories |
| `e2e-cart.ts` | cart, coupons, wishlist |
| `e2e-order.ts` | cart-to-order split, state machine, cancellation, timeline |
| `e2e-payment.ts` | payment, refund, wallet, payout, return |
| `e2e-review.ts` | reviews, questions, coupons, flash sales |
| `e2e-shipping.ts` | zones, methods, partners, riders, settings, admin, API keys |
| `e2e-notification.ts` | notifications, chat, tickets |
| `e2e-analytics.ts` | tracking, analytics, funnels, search, uploads |
| `e2e-content.ts` | pages, blog, FAQ, banners, contact, geo, currency, tax, translations, dropdowns, webhooks, bulk import, reports |
| `e2e-engagement.ts` | loyalty, referrals, gift cards, message templates |
| `e2e-encryption.ts` | AES-256-GCM transport, maintenance mode |

Run an individual suite by path:

```bash
npx tsx scripts/e2e-order.ts
```

`scripts/run-e2e.ps1` runs one to completion in a single blocking call and prints
only the summary plus any failures:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-e2e.ps1 -Script scripts/e2e-content.ts
```

> **The suites share one database.** `loyalty.enabled`, `referral.enabled` and
> `giftCard.enabled` gate the engagement module, so `e2e-engagement.ts` pins those
> settings at the start and restores them in its cleanup. If a suite is killed
> mid-run the settings can be left flipped; the next run resets them.
>
> If the database is reset by anything else, `SUPER_ADMIN` disappears and every
> staff route returns 401. `npm run seed` is idempotent and restores it.

---

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. `npm ci`
2. `npm run prisma:generate`
3. `npm run typecheck`
4. `npm run lint`
5. `npm run test`

The live e2e suites are **not** in CI — they need a real PostgreSQL and take
several minutes, so they run locally.

Formatting is **not** a CI step: most of the tree predates the Prettier config,
so `npm run format:check` would fail until the whole repo is reformatted in one
pass. It is enforced per-commit by `lint-staged` instead.

### Git hooks

`pre-commit` runs `lint-staged`, which formats and lints the staged files only,
so a commit cannot introduce a formatting or lint failure. Configured in
`.lintstagedrc`, wired up by the `prepare` script that `npm install` runs.

`typecheck` and the unit tests are deliberately **not** in `pre-commit` — they
take long enough to make committing unpleasant. `npm run verify` covers both, and
CI enforces them.

---

## Architecture

530 operations across 17 module directories, backed by a 110-model schema. A few
directories export more than one router, so they mount at several prefixes.

| Module | Mount | Operations |
| --- | --- | --- |
| content | `/content`, `/webhooks`, `/pages`, `/blogs`, `/faqs`, `/banners`, `/contact`, `/newsletter`, `/countries`, `/currencies`, `/tax`, `/i18n`, `/bulk`, `/reports`, `/apiKeys` | 82 |
| analytics | `/track`, `/search`, `/uploads`, `/devices`, `/analytics` | 67 |
| shipping | `/shipping`, `/deliveryBoys`, `/settings`, `/admin`, `/auditLogs`, `/activityLogs` | 57 |
| notification | `/notifications`, `/chat`, `/tickets`, `/cannedResponses` | 42 |
| payment | `/payments`, `/payouts`, `/returns`, `/wallet` | 41 |
| auth | `/auth` | 32 |
| engagement | `/loyalty`, `/templates`, `/referral`, `/giftCards` | 30 |
| review | `/reviews`, `/coupons`, `/questions`, `/flashSales` | 29 |
| cart | `/cart`, `/wishlist`, `/priceWatches` | 24 |
| order | `/orders` | 24 |
| catalog | `/brands`, `/attributes`, `/collections`, `/tags` | 23 |
| product | `/products` | 22 |
| user | `/users` | 20 |
| vendor | `/vendors` | 17 |
| category | `/categories` | 8 |
| health | `/health` | 5 |
| system | `/version` | 1 |

Regenerate this table rather than counting by hand — the counts come from the
OpenAPI spec, which is built off the live router. The rows sum to 524; the other
6 of the 530 are the generated `/docs` UI assets and `/docs.json`.

### Conventions

Every module follows the same shape: `<module>.schema.ts` (Zod, `strict()` so
unknown fields are rejected), `<module>.service.ts` (Prisma, throws `AppError`),
`<module>.controller.ts` (`asyncHandler` + `ApiResponse`), `<module>.routes.ts`.

- **Envelope** — responses have exactly `status`, `message`, `result`, in that
  order. `result` is always an object and never contains `null`. Errors append the
  code to the message: `"Product not found. Error Code (NOT_FOUND)"`.
- **Pagination** — only list endpoints, and the fields come first inside `result`.
- **Naming** — CRUD resources are REST-style; self-operations are camelCase verbs
  (`updateProfile`, `cancelOrder`, `getAll`).
- **Serialization** — serializers coerce every field, so a nullable column cannot
  leak a `null` into a response. Credentials (`fcmToken`, webhook secrets, API key
  secrets) are never selected at all.
- **Authorization** — `optionalAuth` for endpoints that personalise output,
  `authenticate` plus `requireRole(...)` for everything else. Guards are applied
  per route, never per controller body.
- **Strings** — no message, number or status literal in a service. Everything comes
  from `src/constants/`, `src/messages/`, `src/config/` or a `SystemSetting`. The
  rules are in [CONVENTIONS.md](docs/CONVENTIONS.md).
- **Comments** — English, and they explain *why*. Four forms: a route marker
  (`/** POST /auth/register */`), a doc block (summary, blank line, then why), an
  inline `//` note, and a section banner. Anything longer than one line is a doc
  block, never a second `//`. A comment that narrates what was broken is not a
  comment — it goes stale and then misleads. Full rules in
  [CONVENTIONS.md](docs/CONVENTIONS.md) under Comment Structure;
  `npm run comments:check` enforces them.
- **Feature flags** — behaviour that can be switched off reads its setting at call
  time (`getSetting`), never from a module-level constant.

### Settings-driven behaviour

`GET /settings/getPublic` exposes the flags that change how the API behaves:
`loyalty.enabled`, `referral.enabled`, `giftCard.enabled`, `payment.*`,
`shipping.*`, `return.*`, `catalog.*`, `security.*`. Each has a seeded default, so
a fresh database is immediately usable.

---

## OTP

`OTP_REQUIRED` is the single switch for the whole system. Every enforcement point
reads it through `src/config/otp-policy.ts`, so toggling it cannot leave one code
path still demanding a code.

| Value | Register | Login | Change password |
| --- | --- | --- | --- |
| `true` (default) | demands a code, and the row is written **only after** it verifies | refuses any account with no verified contact | needs a code sent to the account's own contact |
| `false` | creates the account immediately, unverified | skips the verification check | current password only |

`true` is the default because it is the secure choice. It is not enforced when no
channel can deliver a code, so a fresh clone with no provider is not locked out of
its own login screen. In `NODE_ENV=production` that combination is a boot error
instead — promising codes you cannot send is a deploy mistake, not a runtime
condition.

A code is used for: registration, OTP login, forgot/reset password, email and
phone verification, and changing a password. It is only ever valid for the
identifier it was sent to, and the record is keyed by the channel that identifier
implies, so an SMS code cannot be redeemed as though it arrived by email.

Registration verifies a code in step 2 and returns a single-use
`verificationToken`; step 3 spends it to create the account. The token is bound
to the one contact that was proven, so it cannot be spent on a different email or
phone. OTP login does not need one — the code and the session arrive in the same
call. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for both flows end to end.

### Delivery

**You do not need a provider to build.** With nothing configured, `sendOtp` still
returns 200 and the code is written to the application log. Pair that with
`OTP_STATIC_CODE=111111` and the whole signup flow works offline.

| Channel | Provider | Setup | Free tier |
| --- | --- | --- | --- |
| Email | **Brevo** (`BREVO_API_KEY`) | verified domain, DNS, company details | 300/day |
| Email | any SMTP host | credentials from its dashboard | varies |
| SMS | **MSG91** (`MSG91_AUTHKEY`) | DLT sender + template in India | ~5,000 |

Brevo takes priority over SMTP when both are set. Set `OTP_SMS_ENABLED=true` to
deliver codes to phone numbers — in India a DLT-registered sender id and template
id are mandatory or every send is rejected.

`OTP_STATIC_CODE` pins the code for local work. It is not a bypass — the value is
still hashed, still expires in 10 minutes, and is still capped at 3 attempts and
one resend per minute.

---

## Media storage

Images, video and KYC PDFs go to **Cloudinary** — never to Render's disk, which
is ephemeral and loses everything on every deploy and restart. A request is
written to `uploads/tmp/`, streamed to Cloudinary, and the temp file is unlinked
in a `finally`, so the local disk does not accumulate.

Folders default to `CLOUDINARY_FOLDER/<kind>`; an upload may override them with a
`folder` field in the request body.

| Upload | Destination folder |
| --- | --- |
| Product images | `projectname/products` |
| Vendor KYC | `projectname/kyc/<docType>` |
| Generic / chat media | `projectname/<kind>` |

Without the three `CLOUDINARY_*` variables the API starts fine but every upload
route returns 503, and `GET /api/v1/upload/signed-params` reports
`enabled: false`.

---

## Seeded logins

| Role | Email | Password |
| --- | --- | --- |
| SUPER_ADMIN | `superadmin@projectname.com` | `SUPER_ADMIN_PASSWORD` (default `SuperSecret@123`) |
| SUB_ADMIN | `subadmin@projectname.com` | `Demo@12345` |
| VENDOR | `vendor@projectname.com` | `Demo@12345` |
| CUSTOMER | `customer@projectname.com` | `Demo@12345` |

Seeding is idempotent — every write is an `upsert`, so re-running never
duplicates rows and never clobbers a setting an admin has changed.

The super admin's password is set on first seed only. Changing
`SUPER_ADMIN_PASSWORD` later does not update the row already in the database.

---

## Endpoints

- API — `http://localhost:5000/api/v1`
- OpenAPI JSON — `http://localhost:5000/api/v1/docs.json`
- Health (Render probes this) — `http://localhost:5000/api/v1/health`

---

## Deployment (Render)

`render.yaml` is the source of truth — create the service with **New → Blueprint**
and point it at this repo. Every `sync: false` value is filled in the dashboard.

Build:
`npm ci --include=dev && npx prisma generate && npx prisma migrate deploy && npm run seed && npm run build`
Start: `npm start`
Health check path: `/api/v1/health`

> `--include=dev` is required. `render.yaml` sets `NODE_ENV=production`, which npm
> turns into `omit=dev` (check `npm config get omit`), and `prisma` / `typescript`
> / `tsx` are all devDependencies — a bare `npm ci` would leave the build without a
> compiler.
>
> Do **not** add `--ignore-scripts`. bcrypt pulls its native binary in an install
> script; skipping scripts makes every login throw.
>
> `migrate deploy` only creates the schema. `npm run seed` is what inserts the
> super admin, the 163 settings and the permission matrix — on a fresh database
> you need both. The seed is idempotent, so it is safe on every deploy.

| Dashboard value | Where it comes from |
| --- | --- |
| `DATABASE_URL` | Render Postgres → **Internal** Database URL |
| `REDIS_URL` | Render Key Value, or Upstash / Redis Cloud |
| `CORS_ORIGINS` | Your frontend, e.g. `https://app.yourdomain.com` |
| `SUPER_ADMIN_PASSWORD` | Anything but the built-in `SuperSecret@123` |
| `CLOUDINARY_*` | Cloudinary → Settings → API Keys (Root key) |
| `BREVO_API_KEY` or `SMTP_*` | Required while `OTP_REQUIRED=true`, else the boot is refused |
| `MSG91_*` + `OTP_SMS_ENABLED` | Only if you enable SMS |

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are generated by the blueprint.

Migrations are a single `20260101000000_init` folder, generated from
`prisma/schema.prisma`. It is the full schema — do not add ad-hoc migrations to it
after the first deploy; create a new folder instead.

Set `PGLITE_MODE=false` in production.

> The free Render Postgres plan is deleted 30 days after creation, data included.
> Upgrade before it expires.

---

## Diagnosing

```bash
npm run doctor
```

One screen covering everything that fails silently:

```
[PASS] database       reachable
[PASS] postgres       PostgreSQL 18.6
[PASS] tables         98
[PASS] migrations     1 applied, all present on disk
[FAIL] smtp           not configured — every sendOtp is dropped
[WARN] redis          not set — jobs dropped
```

It also flags weak secrets, `.env` files tracked by git, and the case where OTP is
required but nothing can deliver a code. Use `LOG_LEVEL=debug` for server logs.

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Cannot find module 'dist/server.js'` | Wrong tsconfig. Run `npm run build`; the entry is `dist/server.js` |
| `[env] Invalid environment variables` | The schema rejects it on purpose and names the variable. Usually a missing `DATABASE_URL`, a `JWT_*_SECRET` under 16 chars, or `QUEUE_ENABLED=true` with no `REDIS_URL` |
| `OTP_STATIC_CODE ... must never be set in production` | Empty that variable on Render |
| `OTP_REQUIRED=true in production needs a delivery provider` | Set `BREVO_API_KEY` / `SMTP_*` / `MSG91_*`, or set `OTP_REQUIRED=false` while still building |
| Login fails with `ACCOUNT_UNVERIFIED` | The account was created with `OTP_REQUIRED=false` and never verified. Re-run `npm run seed`, or verify the contact through `POST /auth/verifyEmail` |
| `bcrypt` fails to load | Its native binary is missing. Do not pass `--ignore-scripts`; run `npm install` without it |
| Every route 500s but `/health` is UP | `/health` never touches the database on purpose. Check `/health/db`, then `npm run doctor` |
| Rate limited while testing | `RATE_LIMIT_ENABLED=false` — note this also removes the 1-per-minute OTP send guard |
