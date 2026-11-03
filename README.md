# IELTiva

An AI-assisted IELTS preparation platform, launching first in Bangladesh and designed for international use.

> **Status: Phase 1B, backend foundation.** The design system and API foundation exist, so there's no product to use yet.

IELTiva isn't affiliated with or endorsed by the IELTS partners. Any AI band scores will be estimates, and they won't be shown publicly until validated against human-marked samples.

## Releases

| Release | Scope |
| --- | --- |
| 1 | Public website, authentication, student dashboard, Listening and Reading practice, AI Writing Assessment, basic mock tests, prepaid packages and payments |
| 2 | AI Speaking Assessment, AI IELTS Tutor, personalized study plans, advanced analytics |
| 3 | Advanced AI calibration, more learning content, international payments, performance optimization |

## Documents

| Document | Contents |
| --- | --- |
| [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) | System design, AI service, band gate, verified IELTS facts, decisions |
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md) | Entities, relationships, calibration data, retention |
| [API_DOCUMENTATION.md](API_DOCUMENTATION.md) | Proposed REST API |
| [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) | Releases, phases and parallel tracks |
| [.env.example](.env.example) | Planned environment variables |

## Planned stack

| Layer | Technology |
| --- | --- |
| Web | Next.js, React, TypeScript, Tailwind CSS (port 3000) |
| API and worker | Node.js, Express, TypeScript, BullMQ (port 5000) |
| Data | PostgreSQL, Prisma, Redis |
| Storage | Private Cloudflare R2 buckets |
| AI | Claude through a configurable AI service: Sonnet default, Opus complex, Haiku light |
| Speech | Azure AI Speech, under trial for Release 2 |
| Payments | SSLCommerz behind a gateway interface |

## Requirements for development

IELTiva requires **Node.js 24.22.1 or a newer 24.x release and npm 11.19.1 or newer**, as set in `package.json`, `.nvmrc` and `.node-version`. `.npmrc` makes npm refuse other Node versions in this project.

The API needs PostgreSQL 18. Later phases also need Docker for local Redis, and speaking features need ffmpeg.

### Isolated Node 24 on Windows

Node 24 doesn't need to replace your system Node, so other projects are unaffected.

1. Download `node-v24.22.1-win-x64.zip` from [nodejs.org](https://nodejs.org/dist/v24.22.1/) and check it against `SHASUMS256.txt`.
2. Extract it to `%LOCALAPPDATA%\IELTiva-tools`, so that `%LOCALAPPDATA%\IELTiva-tools\node-v24.22.1-win-x64\node.exe` exists.
3. Run this in each new PowerShell terminal. It affects that terminal only:

```powershell
. .\scripts\use-node.ps1
```

### Run the frontend

```powershell
npm install
npm run dev
```

Open http://localhost:3000, and http://localhost:3000/design-system for the component reference. That page is off in production builds unless `DESIGN_SYSTEM_ENABLED=true` is set at build time.

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check types |
| `npm run lint` | Check code style |
| `npm test` | API and component tests |
| `npm run build` | Production build of shared, API and web |
| `npm run test:e2e` | Browser, responsive and accessibility tests. Build first with `DESIGN_SYSTEM_ENABLED=true`. Uses installed Chrome, and updates `docs/screenshots/phase-1` |

See [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) for frontend standards.

### Run the API

PostgreSQL is IELTiva's only primary database, and version 18 is used in development.

1. Copy `.env.example` to `.env`, and replace every database `CHANGE_ME` with one strong password. URL-encode special characters.
2. Start PostgreSQL on port 5433 using either option below.
3. Apply migrations to both databases and start the API:

```powershell
npm run db:deploy
$env:DATABASE_URL = (Select-String -Path .env -Pattern '^TEST_DATABASE_URL=(.*)').Matches.Groups[1].Value; npm run db:deploy; Remove-Item Env:DATABASE_URL
npm run dev:api
```

Check http://localhost:5000/api/v1/health.

**Option A, Docker:** `npm run db:up` creates the `ieltiva` database. Then run `docker compose exec postgres createdb -U ieltiva ieltiva_test`.

**Option B, a private instance using the installed PostgreSQL 18:** this leaves any existing service unchanged. Put the password alone in a temporary file, then delete the file afterwards:

```powershell
$pg = "C:\Program Files\PostgreSQL\18\bin"
$data = "$env:LOCALAPPDATA\IELTiva-tools\pgdata-18"
& "$pg\initdb.exe" -D $data -U ieltiva --pwfile=password.tmp -A scram-sha-256 -E UTF8 --locale=C
& "$pg\pg_ctl.exe" -D $data -l "$env:LOCALAPPDATA\IELTiva-tools\pg.log" -o "-p 5433 -c listen_addresses=127.0.0.1" start
& "$pg\createdb.exe" -h localhost -p 5433 -U ieltiva ieltiva
& "$pg\createdb.exe" -h localhost -p 5433 -U ieltiva ieltiva_test
```

To restart it later, run the `pg_ctl` line again. To stop it, use `pg_ctl -D $data stop`.

### Prisma workflow

Prisma 7 reads its connection from `apps/api/prisma.config.ts`, not the schema, and connects at runtime through the `@prisma/adapter-pg` driver adapter. The client generates to `apps/api/src/generated/prisma`, which isn't committed.

| Task | Command |
| --- | --- |
| Validate the schema | `npm run db:validate` |
| Generate the client | `npm run db:generate` |
| Create and apply a development migration | `npm run db:migrate -- --name describe_change` |
| Apply committed migrations, including production | `npm run db:deploy` |
| Check migration status | `npm run db:status` |

Don't use `prisma migrate reset` on any database holding data you need.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| `EBADENGINE` from npm | Activate Node 24 with `. .\scripts\use-node.ps1` |
| PowerShell blocks the script | Run `Set-ExecutionPolicy -Scope Process Bypass` in that terminal |
| API exits with `Invalid environment configuration` | Set the named variables in `.env` |
| Health returns 503 | Start PostgreSQL, and check the host, port and password in `DATABASE_URL` |
| Cannot find `generated/prisma` | Run `npm run db:generate` |
| Next.js says another build is running | Stop any running `next dev` or `next start` |

| Command | Purpose |
| --- | --- |
| `npm run test:api` | API tests, with no database needed |
| `npm run test:db` | Real database tests, using `TEST_DATABASE_URL` |
| `npm run build -w @ieltiva/api` | API production build |
| `npm run start:api` | Run the API production build |
