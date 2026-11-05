# Security

For developers, and for anyone doing a security review before launch.

**Status:** this comes from reading the code. No penetration test, load test or attack simulation has been run, and none of the protections below have been exercised against a real attack. Treat them as controls that exist, not as proof that the system is secure. Get an independent security test before accepting real students or payments.

## Fixed in the Phase 9 review

| Finding | Fix |
|---|---|
| Rate limits were counted per server, so adding servers multiplied them | Counts are shared through Redis, and fall back to per-server if Redis is down |
| Password and email changes had no rate limit of their own | Limited per account |
| Anyone could fill the payment notification table with invented references | Unknown references aren't stored |
| Audit log IP addresses were kept forever, and deletion couldn't remove personal data from audit entries | IPs are cleared after a set time. A narrow database rule allows clearing personal fields only, and what happened stays locked |
| No account deletion or data export existed | Both are built |
| Any text could be set as an AI model name | Limited to an approved list |
| One student could use a large share of the AI budget | Per-student daily token ceiling |
| Tutor messages could carry emails and phone numbers to the AI provider | Obvious details are removed first. Names can't be detected this way |
| Payment state relied only on application code | Database rules now also enforce it |
| Database connections could be held indefinitely | Statement and idle-transaction time limits |

## Controls by area

### Sign-in and sessions

- Access tokens: 15-minute HS256 JWTs with pinned algorithm, issuer and audience. They identify a session only, and status, roles and permissions are read from the database on every request.
- Refresh tokens are stored hashed and rotated. Password changes and "sign out everywhere" revoke sessions.
- Cookies: HTTP-only (except the CSRF token), SameSite=Lax, and Secure is required in production.
- CSRF: a signed double-submit token plus an Origin check on every state-changing request. Payment callbacks are excluded because gateways can't send a token, so they never trust their input.
- Google sign-in uses state, nonce and PKCE, and verifies the ID token's signature, issuer and audience.
- Login attempts are rate limited and accounts lock after repeated failures.
- Post-login redirects accept same-site paths only.

### Access to data

- Student routes read the signed-in user's own data, and most take no user ID at all.
- Records are looked up together with their owner, so someone else's ID returns 404.
- Staff routes check a named permission on the server. Hiding a menu item is only a convenience.
- Files are private. Access is checked before anything is streamed or a short-lived link is made.

### Common attacks

| Attack | Protection |
|---|---|
| SQL injection | Prisma, and raw queries use bound parameters only |
| XSS | React escaping, no `dangerouslySetInnerHTML`, lesson content shown as plain text, downloads sent as attachments with a sandbox policy |
| Open redirect | Paths validated, and gateway addresses checked against each gateway's domain and for HTTPS |
| SSRF | Outgoing calls go only to fixed provider addresses, follow no redirects and time out. ffmpeg can read local files only |
| Path traversal | Storage keys are built by our code and validated, and download names are cleaned |
| Unsafe uploads | Type checked from real bytes, size limited, and audio checked with ffmpeg |
| Webhook replay | One record per message, and Stripe timestamp tolerance |
| Prompt injection | See below |
| Brute force | Rate limits per address and per account |

### AI

- Student text is wrapped in tags, escaped and described to the model as data. Tutor exam explanations open only after an attempt has closed.
- Output must match a schema, and quoted evidence that isn't in the student's text is removed.
- Recommendations come from rules using stored numbers. AI only explains them and receives nothing else about the student.
- Bands stay hidden unless calibration and human approval release them. Speaking bands are never released this way.
- Cost controls: a daily budget, a per-student token ceiling, per-feature limits and an approved model list.

Prompt injection can't be fully prevented. These measures limit what a successful one can achieve.

## Known gaps

0. **Gemini's free plan isn't for real student data.** Google may use and read what's sent through it. The consent prompt says so, and beta and production servers refuse to start on it unless `GEMINI_PAID_TIER=true`, which should only be set with real paid billing.

1. **The site's strict content security policy is report-only.** It's sent in production but blocks nothing, because enforcing it untested could break pages. Check real browser reports, then switch it to enforcing.
2. **The CSRF token isn't tied to a session.** The Origin check and SameSite cookies reduce the risk. A session-bound token would be stronger.
3. **Google-only accounts delete with typed confirmation only**, because they have no password. A stolen open session could schedule deletion, but the 14-day window allows cancellation, and no notification is sent yet to warn the owner. Add an email for this.
4. **Personal details in Writing and Speaking** aren't removed before AI assessment, because evidence must quote the student exactly. This is covered by consent.
5. **Encryption at rest** is left to the database and storage hosts. Confirm it when choosing them.
6. **Dependency scanning** runs only when someone runs `npm audit`.
7. **The Marker role is the only proof of being qualified.** The system can't check qualifications, so administrators must assign it carefully.
8. **`npm audit --omit=dev`** reported no known vulnerabilities at the time of writing. That only covers known issues in dependencies, not this code.

## Before launch

- [ ] Independent penetration test
- [ ] Run the existing automated test suites, which weren't run for Phases 5 to 9
- [ ] Add tests for payments, refunds, credits, deletion and export
- [ ] Sandbox-test every gateway, including replayed and tampered notifications
- [ ] Load test
- [ ] Rotate every secret used in development
- [ ] Confirm that R2 buckets are private and that `TRUST_PROXY` is correct
- [ ] Set up the outside uptime monitor
- [ ] Set `AI_DAILY_SPEND_LIMIT_USD`
- [ ] Enforce the content security policy
- [ ] Finish the legal review in `LEGAL_REVIEW.md`
