# Operations Runbook

For whoever deploys and supports IELTiva. None of these procedures has been rehearsed. Rehearse them on a staging server before relying on them, especially backup restore and rollback. See `INFRASTRUCTURE.md` for how the parts fit together.

## Server types

Set `RELEASE_CHANNEL` on the API and worker.

| Channel | Publication approval | Beta list | Live payments |
|---|---|---|---|
| `development` | A switch | A switch | Refused unless explicitly allowed |
| `beta` | Always on | Always on | **Refused at startup** |
| `production` | Always on | A switch | Only if explicitly allowed |

Beta uses `.env.beta.example`, with its own database, Redis, buckets and secrets. Never point it at production data.

## Deployment checklist

**Before**
- [ ] The final test checklist has passed on staging
- [ ] A backup was taken and its restore tested recently
- [ ] Migrations reviewed for anything destructive
- [ ] Secrets set on the server and not in any file in git
- [ ] `TRUST_PROXY` is correct, and R2 buckets are private
- [ ] Release notes written

**Deploy**
1. Take a database backup.
2. Run `npm run db:deploy`, then `npm run db:seed`.
3. Start the new API and worker, and then the web app.
4. Check `/api/v1/health/ready` and **Admin → System health**.

**After**
- [ ] A worker shows as running, and queues are moving
- [ ] Sign in, open a course and start a practice test as a test account
- [ ] Watch errors for 30 minutes

## Database migrations

- Migrations only move forward. Use `npm run db:deploy` on servers, and **never** `prisma migrate dev` or `migrate reset` there, because those can delete data.
- Each change should be additive first: add new columns, deploy, move the data, and only remove old columns in a later release.
- Run `npm run db:status` before and after.
- If one fails partway, stop, look at what was applied, and finish it by hand in a transaction. Then run `prisma migrate resolve`. Don't reset.

## Backup and recovery

Nothing is set up yet, because hosting hasn't been chosen.

| Data | Plan | Suggested starting point |
|---|---|---|
| PostgreSQL | Provider's point-in-time recovery, plus a daily `pg_dump` kept elsewhere | Keep 30 days |
| R2 | Bucket versioning or a scheduled copy, decided with the lawyer | See below |
| Redis | No backup needed | Queued jobs can be repeated. AI jobs can be requested again |
| Secrets | A password manager held by two people | |

**Restore drill, at least every quarter:** restore to a new empty database, point a staging API at it, and sign in. Record how long it took.

**Privacy conflict:** backups keep data that a student has deleted. Keep them short, and after any restore run the deletion and retention tasks again. Ask the lawyer about this.

## Monitoring and alerts

Staff with `operations.read` get in-app alerts at most hourly for: repeated errors, stuck AI jobs, unconfirmed payments, payment mismatches, overdue recording deletion and open critical incidents.

**Those alerts come from the worker, so they stop if the worker stops.** Before beta, add an outside uptime monitor on `/api/v1/health/ready` and the website, which alerts by email or phone. Also check **System health** daily, where a worker that has gone away shows as not running.

## AI cost controls

| Control | Setting |
|---|---|
| Alert and daily limit for the whole platform | `AI_DAILY_SPEND_ALERT_USD`, `AI_DAILY_SPEND_LIMIT_USD` |
| Ceiling per student | `AI_USER_DAILY_TOKEN_LIMIT` (default 500,000 tokens) |
| Requests per student | 10 assessments and 100 tutor messages a day |
| Approved models | `AI_ALLOWED_MODELS` |
| Emergency stop | Switches in **Release controls** |

**Set `AI_DAILY_SPEND_LIMIT_USD` before beta.** There's no platform limit until you do. Also set a limit in the Anthropic console, as a second safeguard. Review **Admin → AI usage** every week. Cost figures are estimates from reference prices, so compare them with the real bill.

## Payment configuration

See `PAYMENTS.md`. On a beta server, keep to sandbox keys, and live mode won't start. Check **Admin → Payments** daily for anything marked `needs_review`. Those students may have been charged and received nothing, so contact them first.

To stop payments quickly, switch off **Checkout**. Payments already open still settle, and refunds still work.

## Incidents

Record every one at **Admin → Release controls → Incidents**.

| Severity | Example | Respond within |
|---|---|---|
| Critical | Data exposed, wrong charges, site down | At once, any hour |
| High | Payments or AI down, exams can't be submitted | 2 hours |
| Medium | One feature failing with a workaround | 1 working day |
| Low | Minor problem | Next release |

1. **Stabilize:** use a switch, the maintenance message or a rollback.
2. **Record:** what happened, when it started and who's affected.
3. **Preserve evidence:** keep logs, and don't delete affected records.
4. **Personal data involved?** Tell the owner and the lawyer **at once**. Legal reporting deadlines may be short, so don't wait for the full picture.
5. **Fix, then write up** what happened and what will prevent it.

If a secret may have leaked, rotate it first: JWT and CSRF secrets (this signs everyone out), database, gateway keys and R2 tokens.

## Support escalation

| Level | Who | Handles |
|---|---|---|
| 1 | Support | Using the app, account questions, feedback |
| 2 | Administrator | Refunds, account problems, payment review |
| 3 | Instructor | Questions about content, marks and feedback quality |
| 4 | Developer | Bugs and outages |
| Always the owner | | Anything legal, personal data, or press |

Names and contact details aren't filled in yet, because they need your decision. Support never asks for passwords or card details.

## Rollback

| Problem | Do this |
|---|---|
| One feature misbehaving | Switch it off in **Release controls**. Takes effect within about 15 seconds |
| A bad release | Redeploy the previous version of the API, worker and web app |
| A bad migration | **Don't reverse it automatically.** Older code usually still works, because migrations add rather than remove. If not, write a new forward fix, or restore from backup as a last resort |
| Bad content | Archive the exam version, or publish a corrected one |

Restoring from backup loses everything since the backup, including payments. Treat it as a last resort, and reconcile with gateway records afterward.

## Beta setup

No beta has been started, and nobody has been invited.

1. Create the beta server from `.env.beta.example`.
2. Finish legal review and publish the reviewed documents.
3. Add approved addresses at **Release controls → Beta access**. This sends nothing, so you tell people yourself.
4. Decide which features are on, using the switches.
5. Keep bands disabled unless calibration has released them.
