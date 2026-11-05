# Infrastructure

For whoever deploys and runs IELTiva. Nothing here has been run yet: Redis, R2, the worker and email have not been started or called. No hosting or storage has been bought.

## What runs

| Process | Command | Needed for |
|---|---|---|
| Web | `npm run build`, then `npm start` in `apps/web` | The site |
| API | `npm run start` in `apps/api` | Everything |
| Worker | `npm run worker:start` in `apps/api` | AI feedback, audio checks, reports, email and scheduled upkeep |
| PostgreSQL 18 | Managed or private | Required |
| Redis | Managed or private | Jobs, shared cache and rate limits |
| Cloudflare R2 | Two private buckets | File storage in production |

**The worker matters for privacy.** Recording deletion, export clean-up and account deletion run there. Without it, none of them happen.

## Without optional services

| Missing | What happens |
|---|---|
| Redis | No AI assessment jobs or email, and caching and rate limits are per server. Reports are made during the request. |
| R2 in development | Files go to `STORAGE_LOCAL_DIR` |
| R2 in production | Uploads are refused. It never falls back to the server's disk. |
| AI provider or Azure keys | AI features report that they're unavailable |
| Email key | Production logs an error and sends nothing |

## Background jobs

| Queue | Jobs | Retries |
|---|---|---|
| `ieltiva-ai` | Writing and Speaking assessment (including transcription), calibration | 3 |
| `ieltiva-audio` | Checks each saved recording and measures its length | 4 |
| `ieltiva-reports` | Progress reports and data exports | 4 |
| `ieltiva-email` | Payment and reminder emails | 4 |
| `ieltiva-maintenance` | Scheduled tasks below | 1, and runs again at its next time |

Sign-in emails are sent directly, because their links contain tokens that shouldn't sit in Redis. Queued emails carry only a user ID, so the address is looked up at sending time.

Scheduled tasks: recording retention, generated file retention, IP clearing in the audit log, expired token and session removal, operational event cleanup, unconfirmed payment checks, entitlement expiry, study reminders and account deletions.

Repeated jobs are safe: each has a stable ID and checks whether its work is already done. On `SIGTERM` the worker stops taking jobs, waits up to 30 seconds for running ones, and then exits. A job that fails for good is recorded and shown on the System health page.

## Cloudflare R2

Create two **private** buckets, with no public access and no custom public domain.

| Variable | Default | Holds |
|---|---|---|
| `R2_BUCKET_USER` | `ieltiva-user` | Recordings, avatars and generated reports |
| `R2_BUCKET_CONTENT` | `ieltiva-content` | Listening audio, images and course documents |

Also set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, using a token limited to these two buckets.

- Access is checked by the API first. It then streams the file or returns a link valid for 2 minutes (reports) or 5 minutes (course files).
- Exam audio and recordings are always streamed through the API, because exam rules such as play limits depend on it.
- Uploads go through the API, where type and size are checked against the real bytes.
- Deletion removes the file first and then the record, so a storage failure is retried and no file is left untracked.
- **Backups:** deleting from R2 doesn't erase anything from backups you configure elsewhere. Decide on backup retention during legal review.

## Audio

ffmpeg comes from the project's `ffmpeg-static` dependency. `FFMPEG_PATH` overrides it, and the value `ffmpeg` is treated as unset so a system copy is never used by accident. It works on a private temporary copy that's always removed, can only read local files, and is stopped after two minutes. A saved recording that turns out not to be audio is removed, so the student can record again.

## Caching

| Scope | Examples | Where | Lifetime |
|---|---|---|---|
| Public | Package list, exam list, course catalog | Redis and memory | 1 to 2 minutes |
| Admin | Platform analytics and revenue, behind a permission check | Redis and memory | 5 minutes |
| Private | One student's analytics, keyed by user ID | **This process's memory only** | 1 minute |

A student's open attempts and enrollments are never cached. Changes to packages clear their cache at once. Exam and course lists can be up to a minute out of date.

## Monitoring

- **Logs:** structured JSON from pino. Every line in a request or job carries `correlationId`, and the same ID is returned as `X-Request-Id`.
- `GET /api/v1/health/live`: the process is up. Use it for restarts.
- `GET /api/v1/health/ready`: returns 503 if the database is unavailable. Use it for routing traffic.
- `GET /api/v1/health`: the original status check.
- **Admin → System health** (`operations.read`): database, Redis, storage, workers, queue depths, stuck work and errors from the last 24 hours, by area.

The worker sends in-app alerts for known problems (see `OPERATIONS_RUNBOOK.md`). Those stop if the worker stops, so add an outside uptime check on `/health/ready` before any beta. `SENTRY_DSN` exists in the settings but isn't wired up.

## Deployment

1. Set the environment from `.env.example`. Production refuses to start without HTTPS addresses and secure cookies.
2. **Set `TRUST_PROXY` to the real number of proxies.** If it's wrong, every student can appear to share one address and hit the same rate limit, or a client can spoof its address and avoid limits.
3. Run `npm run db:deploy`, then `npm run db:seed`. Both are safe to repeat and neither removes data.
4. Start the API, worker and web processes. They run as separate processes and scale separately.
5. Run the checks in `SECURITY.md` before accepting real students.

Each process opens up to `DB_POOL_MAX` database connections (default 10). Multiply by the process count and check it against your database's limit. Queries stop after 30 seconds, and idle transactions after 60.
