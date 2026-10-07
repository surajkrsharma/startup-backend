# AGENTS.md

Orientation for an AI agent working in this repo. Read this first, then the one
doc your task needs. Do not load the others speculatively — they are large.

## What this is

Multi-vendor marketplace REST API. Node 20+, Express 4, TypeScript (strict),
Prisma + PostgreSQL, Redis, Zod, JWT. 527 operations across 17 module
directories, 109 Prisma models.

## Read exactly one of these

| Your task | Read |
| --- | --- |
| Writing or changing any code | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — **start here** |
| Understanding how something works | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Running it, setting it up, deploying | [`README.md`](README.md) |
| Calling an endpoint, or its exact shape | `GET /api/v1/docs.json` (generated from the live router — never out of date) |

## Non-negotiable rules

Breaking these is not a style preference; several are enforced by
`npm run lint`, `npm run comments:check` or the tests.

1. **Responses have exactly `status`, `message`, `result`, in that order.**
   `result` is always an object, never `null`, never a bare array. Errors append
   the code to the message. Build it with `ApiResponse`, never by hand.
2. **No `null` leaves the API.** Serialize every field; a nullable column must
   never surface as `null`.
3. **Pagination numbers come first inside `result`,** and only when a list is
   present. Let `ApiResponse.paginated()` do it.
4. **No message, number or status literal in a service.** Strings come from
   `src/constants/`, `src/messages/`, `src/config/` or a `SystemSetting`.
5. **Module shape is fixed:** `<module>.schema.ts` (Zod, `.strict()`) →
   `.service.ts` (Prisma, throws `AppError`) → `.controller.ts` (`asyncHandler` +
   `ApiResponse`) → `.routes.ts`.
6. **Business logic never goes in a controller.** Service layer only.
7. **Comments are English and explain *why*, never *what*.** Four forms, each
   with one job: route marker, doc block, inline note, banner. Anything over one
   line is a doc block. Never narrate what was broken or what changed — it goes
   stale and then misleads. **A fix adds no comment of its own:** repairing code
   that was not working leaves the surrounding comment count untouched. Only
   write one if the fix introduces an invariant the code cannot express.
8. **Do not commit or push unless asked.** Do not amend a pushed commit.

## Commands

```bash
npm run verify     # the gate: env:check + typecheck + lint + test
npm test           # unit + contract, no database needed
npm run e2e        # live HTTP suites, needs a real database
npm run typecheck  # tsc --noEmit
npm run lint       # eslint src + prisma
npm run format     # prettier
```

`npm run verify` must pass before you call anything done. The e2e suite needs a
reachable database and is excluded from CI, so run it yourself when the change
touches a request path.

## Gotchas that will waste your time if you do not know them

- **Migrations.** There is one folder, `20260101000000_init`, and it holds the
  whole schema. While there is no production data it is fine to edit in place.
  Once real data exists, **never** — add a new dated folder instead.
  The test is **not** whether the database holds real data. It is whether
  `_prisma_migrations` already lists the folder. `migrate deploy` picks
  migrations by *name* and skips anything with a `finished_at`, so an in-place
  edit is a silent no-op on such a database — the schema in the repo moves on
  while the deployed database never hears about it, and the first symptom is a
  seed or boot failure on a column you can see in `schema.prisma`.
  If you hit that, clear the history once (`DELETE FROM "_prisma_migrations";`
  — only safe while there is nothing to lose) and the single-folder shape works
  again. Verify a fresh install by replaying the folder against a throwaway
  database rather than trusting a green `migrate status`.
- **`.env` points at a real remote Postgres.** Editing the schema and running
  `prisma db push` changes the live database. Prefer `db push` over
  `migrate deploy` during development, and never `migrate reset`. `db push` also
  changes the live database without recording anything in `_prisma_migrations`,
  so a deploy afterwards will still think the migration is unapplied.
- **Secrets.** `.env` **is tracked**, on purpose — this is a private repo and it
  is the single source of truth for env values. It holds real credentials, so it
  must never become public: never make the repo public, and keep
  `.env.example` free of real values. `OTP_STATIC_CODE` is refused at boot in
  production; the env schema is the source of truth for what is required.
- **`scripts/e2e-*.ts` hit the real app and a real database.** They are not unit
  tests and are not run by `npm test`.
- **Running e2e against local PGlite needs three URL parameters.** Bare
  `postgresql://postgres:postgres@127.0.0.1:5432/postgres` fails with
  `42P05 prepared statement already exists`, then with dropped connections.
  Use
  `?pgbouncer=true&statement_cache_size=0&connection_limit=1` — PGlite's socket
  server cannot handle Prisma's prepared statements or concurrent connections.
  Order matters too: `db:down` → `db:migrate` → `db:up` → `seed`. Running
  `db:migrate` while the server holds the dataDir leaves `_prisma_migrations`
  populated with no tables, and it then reports "nothing to apply" forever; the
  cure is deleting the local `pglite-data`. One known casualty of
  `connection_limit=1`: any interactive transaction that queries the outer
  client instead of its own `tx` (loyalty `adjustPoints`) deadlocks and fails
  `P2028` at the 5s timeout. That is the harness, not the code — confirm those
  against a real Postgres before believing them.
- **Two OTP shapes.** Registration is three steps and mints a
  `verificationToken`; OTP login is two steps and signs in from the verify call
  itself. Do not add an inline `otp` back onto `/auth/login` or
  `/auth/loginWithOtp` — `/auth/loginWithOtp` no longer exists.
- **OTP purpose is never client-chosen.** A code is only valid for the purpose it
  was sent under.
- **OpenAPI ordering is explicit.** The register and login flow is pinned to the
  top of the spec in `src/docs/swagger.routes.ts`; keep that list in step with
  the real route order.

## Working method

1. Read the module you are touching end to end before editing it.
2. Match the surrounding style. This codebase is unusually consistent on purpose.
3. Change code and the docs that describe it in the same change, or the docs are
   already stale.
4. If a fact in a doc disagrees with the code, the code is right — fix the doc
   and say so.
5. Run `npm run verify`, and `npm run e2e` if the change touches a request path.
6. Report what you changed and what you verified. Do not claim a check you did
   not run.
