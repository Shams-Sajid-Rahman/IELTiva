# IELTiva API Documentation

**Status:** proposed contract, updated for the decisions of 2026-11-03. Nothing here is implemented yet.

Only the Health endpoints are implemented so far. Endpoints marked **R2** arrive in Release 2.

**Base URL:** `/api/v1`. Local: `http://localhost:5000/api/v1`.

## Conventions

### Authentication

The API uses `HttpOnly` cookies, so browser requests send `credentials: "include"`. State-changing requests also send the `X-CSRF-Token` header, matching the readable CSRF cookie.

Access levels below: **Public**, **User** (signed in), **Verified** (email confirmed), **Marker** (assigned calibration samples only), **Editor**, **Admin**, **Super** (`SUPER_ADMIN`). Admin includes Editor, and Super includes Admin. Marker is separate and grants nothing else.

### Responses

Types for these formats are in `packages/shared`.

```json
{ "success": true, "message": "Attempt loaded", "data": { "id": "0194f3a2-..." } }
```

Lists include pagination:

```json
{
  "success": true,
  "message": "Attempts loaded",
  "data": [],
  "meta": { "page": 1, "pageSize": 20, "total": 134, "totalPages": 7 }
}
```

Errors:

```json
{
  "success": false,
  "message": "You don't have any writing assessment credits left.",
  "error": {
    "code": "CREDITS_EXHAUSTED",
    "details": { "feature": "writing_assessment", "balance": 0 },
    "requestId": "req_01J..."
  }
}
```

| Status | Example codes | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid input, with field details |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED` | Sign in or refresh |
| 403 | `FORBIDDEN`, `CSRF_FAILED`, `EMAIL_NOT_VERIFIED`, `ENTITLEMENT_REQUIRED` | Not allowed |
| 404 | `NOT_FOUND` | Missing, or belongs to another user |
| 409 | `ATTEMPT_ALREADY_SUBMITTED`, `ACTIVE_ATTEMPT_EXISTS` | State conflict |
| 410 | `ATTEMPT_EXPIRED` | Time ran out |
| 413 | `FILE_TOO_LARGE` | Over the limit |
| 429 | `RATE_LIMITED`, `CREDITS_EXHAUSTED` | Slow down or buy a package |
| 503 | `FEATURE_UNAVAILABLE` | Provider isn't configured or is down |

### Lists

Query parameters: `page`, `pageSize` (maximum 100), `sort` (for example `-createdAt`), plus the filters listed per endpoint.

### Slow operations

Assessments return `202 Accepted` with a job:

```json
{ "success": true, "message": "Assessment queued", "data": { "jobId": "0194f3b8-...", "status": "PENDING" } }
```

Poll `GET /jobs/:id` every few seconds. Job states are `PENDING`, `PROCESSING`, `COMPLETED` and `FAILED`.

### Idempotency

Endpoints that spend credits or start payment accept an `Idempotency-Key` header, so a double click or retry doesn't charge twice.

### Rate limits

| Scope | Limit (starting value) |
| --- | --- |
| Login, register, password reset | 5 per 15 minutes per IP and email |
| General API | 300 per minute per user |
| Autosave | 120 per minute per attempt |
| Tutor messages (R2) | 20 per minute per user, plus entitlement |
| Assessment submissions | 10 per hour per user, plus credits |

## Authentication

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | Create account, send verification email |
| POST | `/auth/login` | Public | Start session |
| POST | `/auth/logout` | User | End this session |
| POST | `/auth/logout-all` | User | End all sessions |
| POST | `/auth/refresh` | Public, with cookie | Rotate tokens |
| GET | `/auth/csrf` | Public | Issue CSRF token |
| POST | `/auth/verify-email` | Public | Confirm with token |
| POST | `/auth/resend-verification` | User | Send again |
| POST | `/auth/forgot-password` | Public | Always returns 202 |
| POST | `/auth/reset-password` | Public | Set password, revoke sessions |
| GET | `/auth/google` | Public | Start Google sign-in |
| GET | `/auth/google/callback` | Public | Finish Google sign-in |

Example register request:

```json
{
  "email": "student@example.com",
  "password": "at-least-10-characters",
  "firstName": "Student",
  "lastName": "Example",
  "acceptTerms": true
}
```

## Users

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/me` | User | Account, profile, passes, credit balances |
| PATCH | `/me` | User | Update name, avatar, locale, timezone, country |
| POST | `/me/avatar/upload-url` | User | Presigned avatar upload |
| PATCH | `/me/profile` | User | Target band, exam date, module, study hours |
| POST | `/me/change-password` | User | Change password |
| GET | `/me/sessions` | User | Signed-in devices |
| DELETE | `/me/sessions/:id` | User | Revoke a device |
| POST | `/me/data-requests` | User | Request `EXPORT` or `DELETE`. Deletion requires re-authentication |
| GET | `/me/data-requests` | User | Status, and export download link when ready |
| POST | `/me/data-requests/:id/cancel` | User | Cancel during the window |

## Public content

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/public/products` | Public | Packages and passes. Filter: `region`, with prices in that region's currency |
| GET | `/public/regions` | Public | Active regions, currencies and locales |
| GET | `/public/blog`, `/public/blog/:slug` | Public | Articles |
| GET | `/public/faqs` | Public | FAQ |
| POST | `/public/contact` | Public | Contact form, rate limited |
| GET | `/public/free-test` | Public | Sample test |
| POST | `/public/free-test/score` | Public | Mark sample answers |

## Listening and Reading

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/papers` | User | Library. Filters: `skill`, `module`, `difficulty`, `premium`, `completed` |
| GET | `/papers/:id` | User | Summary, no questions |
| POST | `/papers/:id/attempts` | Verified | Start. Body: `{ "mode": "TIMED" }` |
| GET | `/attempts` | User | History |
| GET | `/attempts/:id` | User | Resume: content, saved answers, `expiresAt`, server time |
| PUT | `/attempts/:id/answers` | User | Batch autosave |
| POST | `/attempts/:id/submit` | User | Mark and finish |
| GET | `/attempts/:id/review` | User | Results, keys, explanations, transcript. Only after submission |
| GET | `/attempts/:id/audio` | User | Short-lived audio URL for Listening |

Autosave request:

```json
{
  "answers": [
    { "questionId": "0194...", "response": { "text": "library" }, "isFlagged": false }
  ]
}
```

Response to `GET /attempts/:id` never includes `answerKey` or `explanation`.

## Writing

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/writing/prompts`, `/writing/prompts/:id` | User | Prompt library |
| POST | `/writing/submissions` | Verified | Create draft |
| PATCH | `/writing/submissions/:id` | User | Autosave draft |
| POST | `/writing/submissions/:id/submit` | Verified | Queue assessment, returns 202, reserves a credit |
| GET | `/writing/submissions` | User | History |
| GET | `/writing/submissions/:id` | User | Text, status, current assessment |
| POST | `/writing/submissions/:id/rewrite` | Verified | New draft linked to the original |

Assessment shape:

```json
{
  "bandVisibility": "HIDDEN",
  "overallBand": null,
  "isEstimate": true,
  "criteria": {
    "taskResponse": { "band": null, "summary": "...", "evidence": ["..."] },
    "coherenceCohesion": { "band": null, "summary": "...", "evidence": ["..."] },
    "lexicalResource": { "band": null, "summary": "...", "evidence": ["..."] },
    "grammar": { "band": null, "summary": "...", "evidence": ["..."] }
  },
  "corrections": [
    { "original": "...", "suggestion": "...", "explanation": "..." }
  ],
  "priorities": ["..."]
}
```

`bandVisibility` is `HIDDEN`, `INTERNAL` or `PUBLIC`. **Band fields are `null` in the response unless the viewer is allowed to see them**, based on an open `ai_band_releases` row matching the assessment's task, model, prompt and rubric. Non-band feedback doesn't state or imply a band.

## Speaking (R2)

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/speaking/sets`, `/speaking/sets/:id` | User | Topic library |
| POST | `/speaking/sessions` | Verified | Start. Body: `{ "setId": "..." }` |
| GET | `/speaking/sessions`, `/speaking/sessions/:id` | User | History, progress, questions |
| POST | `/speaking/sessions/:id/responses/upload-url` | User | Presigned upload URL |
| POST | `/speaking/sessions/:id/responses` | User | Confirm an upload |
| POST | `/speaking/sessions/:id/submit` | Verified | Queue processing, returns 202, reserves a credit |
| GET | `/speaking/sessions/:id/report` | User | Transcript, three-criterion feedback and `pronunciationFeedback` as a separate object. `completeBand` stays `null` until all four criteria are validated |
| GET | `/speaking/responses/:id/audio` | User | Short-lived playback URL |
| DELETE | `/speaking/responses/:id/audio` | User | Delete recording, keep the report |

Upload URL request:

```json
{ "questionId": "0194...", "mimeType": "audio/webm", "sizeBytes": 1843200 }
```

## AI jobs

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/jobs/:id` | User | Status of the user's own job |

## AI tutor (R2)

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/tutor/conversations` | Verified | List |
| POST | `/tutor/conversations` | Verified | Create |
| GET | `/tutor/conversations/:id/messages` | Verified | History, text only |
| POST | `/tutor/conversations/:id/messages` | Verified | Send message and receive an SSE stream |
| PATCH | `/tutor/conversations/:id` | Verified | Rename or archive |
| DELETE | `/tutor/conversations/:id` | Verified | Delete |

The client sends the message with `fetch` and reads the response stream, because `EventSource` can't send POST requests.

```text
event: message.start
data: {"messageId":"0194..."}

event: text.delta
data: {"text":"A strong thesis "}

event: tool.status
data: {"label":"Checking your recent writing results"}

event: message.end
data: {"usage":{"remainingThisMonth":142}}

event: error
data: {"code":"AI_UNAVAILABLE","message":"The tutor couldn't finish that reply."}
```

## Mock exams

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/mocks` | User | Available mocks |
| POST | `/mocks/:id/sessions` | Verified | Start |
| GET | `/mock-sessions` | User | History |
| GET | `/mock-sessions/:id` | User | Stage and linked attempt, submissions or speaking session |
| POST | `/mock-sessions/:id/advance` | User | Move on once the current stage is finished |
| GET | `/mock-sessions/:id/report` | User | Section results, pending items marked. `overallBand` is `null` until all four skills exist and are releasable |

## Analytics

| Method | Path | Access | Release | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/analytics/overview` | User | 1 | Listening and Reading results, releasable bands, time spent |
| GET | `/analytics/activity` | User | 1 | Daily activity |
| GET | `/analytics/band-trend` | User | 2 | Filters: `skill`, `from`, `to` |
| GET | `/analytics/question-types` | User | 2 | Accuracy per type. Filter: `skill` |
| GET | `/analytics/criteria-trend` | User | 2 | Writing and speaking criteria over time |

## Study planner (R2)

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/planner/plans` | Verified | Queue generation, returns 202 |
| GET | `/planner/plans/active` | User | Current plan |
| GET | `/planner/items` | User | Filters: `from`, `to` |
| PATCH | `/planner/items/:id` | User | Complete or reschedule |
| POST | `/planner/plans/active/replan` | Verified | Regenerate remaining days, returns 202 |

## Billing

There are no recurring subscriptions. Students buy prepaid packages and passes. Webhook and return paths use the gateway's code, so another gateway adds a path value and an implementation.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/billing/entitlements` | User | Active passes, credit balances, free allowance |
| GET | `/billing/credit-ledger` | User | Credit history |
| POST | `/billing/coupons/validate` | Verified | Preview a discount |
| POST | `/billing/checkout` | Verified | Create pending payment, returns the gateway URL |
| GET | `/billing/payments` | User | History |
| GET | `/billing/payments/:id` | User | Details and status |
| POST | `/billing/webhooks/:gateway` | Gateway | Event or IPN, validated with the gateway before any access change |
| POST | `/billing/return/:gateway/:result` | Gateway redirect | Return from checkout, redirects to `/billing/result`. Grants nothing |

Checkout request:

```json
{ "productPriceId": "0194...", "couponCode": "WELCOME10", "gateway": "sslcommerz" }
```

The webhook and return routes skip CSRF checks because the gateway calls them. The API rejects a gateway not enabled for the price's region. The webhook handler relies on server-to-server validation and amount checks, and always responds idempotently.

## Media

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/media/upload-url` | Editor | Presigned content upload |
| POST | `/media/:id/confirm` | Editor | Verify and activate |

Student recording uploads use the Speaking endpoints.

## Calibration marking

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/marking/assignments` | Marker | Own queue |
| GET | `/marking/assignments/:id` | Marker | De-identified sample, with no AI result and no other marks |
| POST | `/marking/assignments/:id/mark` | Marker | Submit once, with criterion bands and notes |

## Notifications

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/notifications` | User | List |
| POST | `/notifications/:id/read` | User | Mark one as read |
| POST | `/notifications/read-all` | User | Mark all as read |

## Admin

All paths start with `/admin`. All writes create an audit log entry.

### Content (Editor)

| Method | Path | Purpose |
| --- | --- | --- |
| GET, POST | `/papers` | List and create |
| GET, PATCH, DELETE | `/papers/:id` | Read, edit drafts, delete unused drafts |
| POST | `/papers/:id/sections` | Add section |
| PATCH, DELETE | `/sections/:id` | Edit |
| POST | `/sections/:id/groups` | Add question group |
| PATCH, DELETE | `/groups/:id` | Edit |
| POST | `/groups/:id/questions` | Add question |
| PATCH, DELETE | `/questions/:id` | Edit |
| POST | `/papers/:id/submit-review` | Send for review |
| POST | `/papers/:id/new-version` | Copy a published paper as a draft |
| GET, POST | `/writing-prompts` | List and create |
| GET, PATCH, DELETE | `/writing-prompts/:id` | Manage |
| POST | `/writing-prompts/:id/submit-review` | Send for review |
| GET, POST | `/speaking-sets` | List and create (R2) |
| GET, PATCH, DELETE | `/speaking-sets/:id` | Manage, including its questions (R2) |
| POST | `/speaking-sets/:id/submit-review` | Send for review (R2) |
| GET, POST | `/blog` | List and create |
| GET, PATCH, DELETE | `/blog/:id` | Manage |
| GET, POST | `/faqs` | List and create |
| PATCH, DELETE | `/faqs/:id` | Manage |
| POST | `/content-drafts` | Queue AI draft, always saved as `DRAFT` with `AI_ASSISTED_REVIEWED` pending review |

### Operations (Admin)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/papers/:id/publish` | Publish after validation, reviewer must differ from author |
| POST | `/writing-prompts/:id/publish` | Publish, same rule |
| POST | `/speaking-sets/:id/publish` | Publish, same rule (R2) |
| GET, POST | `/mocks` | List and create |
| GET, PATCH | `/mocks/:id` | Manage |
| GET | `/stats/overview` | Users, revenue, activity |
| GET | `/users` | Search and filter |
| GET | `/users/:id` | Details |
| PATCH | `/users/:id` | Suspend or restore |
| POST | `/users/:id/grant-access` | Grant a pass or credits manually, with a reason |
| GET | `/ai/usage` | Tokens and cost by day, task, model and user, and cost per completed assessment |
| GET, POST | `/ai/prices` | Dated model prices |
| GET | `/ai/jobs` | Failed and running jobs |
| POST | `/ai/jobs/:id/retry` | Retry |
| GET | `/assessment-reviews` | Flagged and sampled assessments |
| POST | `/assessment-reviews/:id` | Add human review |
| GET, POST | `/calibration/samples` | List and add |
| GET, PATCH | `/calibration/samples/:id` | Manage, reject or withdraw |
| POST | `/calibration/samples/import` | Import from the agreed template |
| POST | `/calibration/samples/:id/assignments` | Assign markers |
| POST | `/calibration/samples/:id/approve` | Approve the final reference marks |
| GET, POST | `/calibration/datasets` | List and create |
| POST | `/calibration/datasets/:id/freeze` | Freeze a version |
| GET, POST | `/calibration/runs` | List and queue a run |
| GET | `/calibration/runs/:id` | Metrics and per-sample results |
| GET | `/band-releases` | Current and past releases |
| GET, POST | `/products` | List and create |
| PATCH | `/products/:id` | Edit |
| POST | `/products/:id/prices` | Add a regional price, past payments keep theirs |
| GET, POST | `/regions` | List and create |
| PATCH | `/regions/:id` | Currency, locale and gateways |
| GET | `/retention-policies` | List |
| PATCH | `/retention-policies/:dataType` | Change a period or action |
| GET | `/data-requests` | Export and deletion queue |
| POST | `/data-requests/:id/retry` | Retry a failed request |
| GET, POST | `/coupons` | List and create |
| PATCH | `/coupons/:id` | Edit or disable |
| GET | `/payments` | Search |
| POST | `/payments/:id/refund` | Record or start a refund and adjust access |
| GET | `/messages` | Contact messages |
| PATCH | `/messages/:id` | Mark handled |
| GET | `/audit-log` | Search |

### System (Super)

| Method | Path | Purpose |
| --- | --- | --- |
| PATCH | `/users/:id/role` | Change staff role |
| GET | `/ai/routes` | Effective task routes and tier models |
| PATCH | `/ai/routes/:task` | Override a route. Closes the band release if a band-producing model changes |
| POST | `/band-releases` | Open `INTERNAL`, or `PUBLIC` with a passing test-split run and both sign-offs |
| POST | `/band-releases/:id/close` | Close immediately, with a reason |

## Health

Implemented. Public, with no authentication.

`GET /api/v1/health` checks the process and database, waiting up to 5 seconds for the database.

| Status | Meaning |
| --- | --- |
| 200 | API running and database connected |
| 503 | Database unavailable. No internal error details are returned |

```json
{
  "success": true,
  "message": "IELTiva API is running",
  "data": {
    "application": "IELTiva API",
    "apiVersion": "v1",
    "environment": "development",
    "status": "healthy",
    "database": "connected",
    "timestamp": "2026-11-03T13:00:00.000Z"
  }
}
```

When unhealthy, `success` is `false`, `message` is `IELTiva API is unhealthy`, `status` is `unhealthy` and `database` is `disconnected`.
