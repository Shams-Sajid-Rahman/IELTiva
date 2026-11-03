# IELTiva API Documentation

**Status:** Health, Authentication and Core platform are implemented. Other sections are the proposed contract for later phases.

Documented differences from the requested Phase 3 list are marked **Added**, and all of them are additions. Table names in later sections come from the Phase 0 design, and [DATABASE_DESIGN.md](DATABASE_DESIGN.md#differences-from-the-phase-0-design) lists what Phase 2A changed. Future endpoints will be reconciled when each is built. Endpoints marked **R2** arrive in Release 2.

**Base URL:** `/api/v1`. Local: `http://localhost:5000/api/v1`.

## Conventions

### Authentication

The API uses `HttpOnly` cookies, so browser requests send `credentials: "include"`. State-changing requests also send the `X-CSRF-Token` header, matching the readable, signed CSRF cookie from `GET /auth/csrf`.

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

Implemented in Phase 2B. Every `POST` needs a CSRF token, so call `GET /auth/csrf` first and send its value in the `X-CSRF-Token` header. Sessions use cookies only, and no token appears in a response body.

| Method | Path | Access | Purpose | Success | Rate limit per IP, 15 minutes |
| --- | --- | --- | --- | --- | --- |
| GET | `/auth/csrf` | Public | Issue a CSRF token | 200 | None |
| POST | `/auth/register` | Public | Create a student and send a verification email | 201 | 15 |
| POST | `/auth/login` | Public | Start a session | 200 | 30 |
| POST | `/auth/refresh` | Refresh cookie | Rotate tokens | 200 | 120 |
| POST | `/auth/logout` | Public | End this session and clear cookies | 200 | None |
| POST | `/auth/logout-all` | User | End all sessions | 200 | None |
| GET | `/auth/me` | User | Current user | 200 | None |
| POST | `/auth/verify-email` | Public | Confirm with `{ "token" }` | 200 | 30 |
| POST | `/auth/resend-verification` | Public | Send again with `{ "email" }`. Always 202 | 202 | 10 |
| POST | `/auth/forgot-password` | Public | Request a reset with `{ "email" }`. Always 202 | 202 | 10 |
| POST | `/auth/reset-password` | Public | Set a password and end all sessions | 200 | 30 |
| GET | `/auth/google` | Public | Redirect to Google. `?intent=link` needs a session | 302 | 30 |
| GET | `/auth/google/callback` | Google | Finish sign-in or linking | 302 | 30 |

Register request:

```json
{
  "firstName": "Student",
  "lastName": "Example",
  "email": "student@example.com",
  "password": "at-least-10-characters",
  "confirmPassword": "at-least-10-characters",
  "termsAccepted": true
}
```

Passwords need 10 to 128 characters with a lowercase letter, an uppercase letter and a number. Common words and the email name aren't allowed. Unknown fields such as `role` are rejected.

Register response:

```json
{
  "success": true,
  "message": "Account created. Please verify your email.",
  "data": {
    "user": { "id": "0194...", "email": "student@example.com", "firstName": "Student", "lastName": "Example", "emailVerified": false, "roles": ["STUDENT"], "permissions": ["attempts.own", "content.read"] },
    "verificationEmailDelivered": true
  }
}
```

`verificationEmailDelivered` is `true` only when a real provider accepted the email.

| Status | Case |
| --- | --- |
| 400 | Invalid input, or an invalid, used or expired link |
| 401 | Wrong credentials, a locked account, or an ended session, all with generic messages |
| 403 | `CSRF_FAILED`, or a correct password on a suspended account |
| 409 | Registering an email that already exists |
| 429 | Rate limit reached |
| 503 | The Google callback was called without Google configured. `GET /auth/google` redirects with `google_unavailable` instead |

Auth responses use `Cache-Control: no-store`. Recovery emails are limited to one per address per minute, with the same response either way.

**Sessions:** access tokens last 15 minutes. Refresh tokens rotate on every use, within a 30-day session. Reusing an old token ends that whole session.

**Google result:** the callback redirects to `<FRONTEND_URL>/auth/google/result` with `status` set to `signed_in`, `linked` or `error`. `reason` is one of `invalid_state`, `google_denied`, `google_unavailable`, `session_changed`, `google_validation_failed`, `email_not_verified`, `account_exists`, `already_linked`, `verify_email_first` or `account_unavailable`. An existing password account is never linked by email. Its owner signs in, verifies their email and uses `?intent=link`.

## Core platform

Implemented in Phase 3. Every route needs a signed-in user and returns `Cache-Control: no-store`. State-changing routes need the CSRF token. Lists accept `page` and `pageSize` (maximum 100) and return `meta`. A permission listed here is checked on the server for each request. Ownership checks happen inside the services, and someone else's private record returns 404.

### Dashboard

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/dashboard/student` | Signed in | Own profile summary, progress, streak, activity, tasks and recommendations |
| GET | `/dashboard/admin` | `dashboard.admin` | Metrics and recent activity. Each activity list also needs its own read permission |
| GET | `/dashboard/analytics?from&to` | `dashboard.admin` | Daily registrations, enrollments and activity in UTC, plus course popularity. One year at most |

### Users

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/users` | `users.read` | Filters: `search`, `role`, `status`. Sort: `createdAt`, `email`, `lastLoginAt`, with `-` for descending |
| GET | `/users/:id` | `users.read` | Details, enrollments and learning summary, never credentials |
| PATCH | `/users/:id` | `users.manage` | `firstName`, `lastName` |
| PATCH | `/users/:id/status` | `users.manage` | `ACTIVE` or `SUSPENDED`. Suspension ends all sessions |
| GET | `/users/:id/activity` | `users.read` | Learning events. Administrative changes also need `audit.read` |
| PATCH | `/users/:id/roles` | `roles.assign` | Replaces the person's roles |

**Authority rules:** nobody can act on someone who holds permissions they lack, or assign or remove a role with permissions they lack. You can't give yourself a role, remove your own last administrative role, or suspend yourself. The last active super administrator can't be removed or suspended.

### Roles and permissions

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/roles`, `/roles/:id` | `roles.read` | Roles, their permissions and user counts |
| GET | `/permissions` | `roles.read` | Permissions by group |
| PATCH | `/roles/:id/permissions` | `roles.manage` | Replaces a role's permissions |

`SUPER_ADMIN` can't be changed. `roles.manage`, `settings.manage`, `ai.configure` and `ai.band_release` can't be given to any other role. `STUDENT` can hold only `content.read` and `attempts.own`.

### Courses, sections and resources

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/courses` | Signed in | `scope=catalog` shows published courses. `scope=manage` needs a course permission. Filters: `search`, `status`, `moduleId`, `skill`, `examType`, `difficulty`, `sort` |
| POST | `/courses` | `courses.manage` or `courses.manage_all` | Create a draft |
| GET | `/courses/:id` | Signed in | Published, or archived if enrolled, or any status for its managers. Lesson content isn't included |
| PATCH | `/courses/:id` | Course manager | Update. Only `courses.manage_all` can change the instructor |
| DELETE | `/courses/:id` | Course manager | Soft delete, only if unpublished and never enrolled in |
| POST | `/courses/:id/publish` | `courses.publish` and course manager | Validates content first, returning problems in `error.details` |
| POST | `/courses/:id/unpublish` | `courses.publish` and course manager | **Added.** Back to draft, only with no active students |
| POST | `/courses/:id/archive` | `courses.publish` and course manager | No new enrollments. Enrolled students keep access |
| GET | `/courses/:id/history` | Course manager | **Added.** Publication history |
| GET, POST | `/courses/:id/sections` | Signed in, course manager | List visible sections, or add one |
| PATCH, DELETE | `/sections/:id` | Course manager | Update, reorder through `position`, show or hide, or archive |
| POST | `/sections/:id/resources` | Course manager | Add a resource |
| GET | `/resources/:id` | Enrolled or course manager | **Added.** Lesson content with next and previous IDs |
| PATCH, DELETE | `/resources/:id` | Course manager | Update, reorder or soft delete |

Instructors with `courses.manage` manage only courses they teach. `courses.manage_all` covers every course. Storage keys are never returned.

### Learning modules

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/modules`, `/modules/:id` | Signed in | Published ones. All statuses with `modules.manage` |
| POST, PATCH | `/modules`, `/modules/:id` | `modules.manage` | Create a draft, or update |
| POST | `/modules/:id/publish`, `/modules/:id/archive` | `modules.manage` | Archiving is refused while published courses use it |

### Enrollments, progress and history

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/enrollments` | `enrollments.read` | All enrollments. Filters: `search`, `status`, `courseId` |
| POST | `/enrollments` | Signed in | Enroll in a published course. Duplicate returns 409. A premium course without a pass returns 403 `ENTITLEMENT_REQUIRED` |
| GET | `/enrollments/me` | Signed in | Own enrollments with calculated progress |
| GET | `/enrollments/:id` | Owner or `enrollments.read` | One enrollment |
| PATCH | `/enrollments/:id` | Owner to cancel, or `enrollments.manage` | **Added.** Change status |
| POST | `/progress` | Enrolled | `resourceId`, `status`, `minutesSpent`. A completed lesson can't regress |
| GET | `/progress/me` | Signed in | Progress per course |
| GET | `/history/me` | Signed in | Own learning history |

### Study planner

Own tasks only, written by the student. **Added**, because the student dashboard links to it. `GET` and `POST /planner/tasks`, and `PATCH` and `DELETE /planner/tasks/:id`.

### Profile and settings

| Method | Path | Purpose |
| --- | --- | --- |
| GET, PATCH | `/profile/me` | Own profile. Only `firstName` and `lastName` can be changed here |
| PATCH | `/profile/preferences` | IELTS type, target band, exam date, study hours, daily goal, focus skills, locale, timezone, notification preferences |
| PUT, GET, DELETE | `/profile/photo` | **Added.** Raw PNG, JPEG or WebP up to 2 MB, checked by its real bytes. Own photo only |
| POST | `/profile/password` | **Added.** Needs the current password. Ends other sessions |
| POST | `/profile/email` | **Added.** Needs the current password, and returns 202 either way. Changes only after the new address confirms through `/auth/verify-email` |
| GET | `/profile/sessions` | Own sessions, never tokens |
| DELETE | `/profile/sessions`, `/profile/sessions/:id` | End all other sessions, or one |

### Notifications

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/notifications` | Signed in | Own list. Filters: `type`, `unread` |
| GET | `/notifications/unread-count` | Signed in | **Added.** For the bell |
| PATCH | `/notifications/:id/read`, `/notifications/read-all` | Signed in | Mark as read |
| DELETE | `/notifications/:id` | Signed in | Dismiss |
| GET, POST | `/admin/notifications` | `notifications.manage` | List or create announcements for `ALL` or one `ROLE`, as a draft or published, with optional expiry |
| POST | `/admin/notifications/:id/publish`, `/archive` | `notifications.manage` | **Added.** Publish a draft, or archive |

These are in-app only. No email or push delivery exists for them.

### Administration

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/admin/audit-logs` | `audit.read` | Filters: `action`, `entityType`, `actorId`, `from`, `to`. Read-only |
| GET | `/admin/settings` | `settings.read` | **Added.** Platform settings |
| PATCH | `/admin/settings/:key` | `settings.manage` | **Added.** Validated per setting and audited |

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

## Payments and packages (built)

These replace the proposed "Billing" section below. See `PAYMENTS.md`. All need a signed-in user unless marked public.

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/packages`, `/packages/:id` | | Packages on sale |
| GET | `/billing/gateways?currency=` | | Usable payment methods |
| POST | `/billing/checkout` | | Starts a payment. Body: `packageId`, `currency`, `gateway`, `idempotencyKey` |
| GET | `/billing/payments/:reference/status` | Own | Result, confirmed with the gateway |
| GET | `/billing/purchases`, `/billing/refunds` | Own | History |
| GET | `/billing/credits`, `/billing/credits/history` | Own | Remaining credits, expiry, changes |
| POST | `/billing/refunds` | Own | Requests a refund |
| GET, POST, PATCH, DELETE | `/admin/packages` | `payments.read`, `payments.manage` | Packages and pricing |
| GET | `/admin/transactions` | `payments.read` | Filter by status, gateway or search |
| POST | `/admin/transactions/:id/recheck` | `payments.manage` | Asks the gateway again |
| GET | `/admin/refunds` | `payments.read` | Refund queue |
| POST | `/admin/refunds/:id/decision`, `/send`, `/complete` | `refunds.manage` | Decide, send to gateway, record a manual refund |
| GET | `/admin/revenue` | `payments.read` | Per currency |
| GET, PATCH | `/admin/gateways` | `gateways.manage` | Switch on and off |
| POST | `/payments/webhooks/:gateway` | Public | Gateway notification, which only prompts a check |
| GET, POST | `/payments/return/:gateway/:outcome` | Public | Browser return, then a redirect to the status page |

## Analytics and study planning (built)

Every `/analytics` route works on the signed-in student's own data.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/analytics/me?days=` | Overview, skills, trends, question types, activity, target. Raw, estimated and reviewed scores are kept separate |
| GET | `/analytics/me/history` | Paginated test history |
| GET, PUT | `/analytics/goals` | Goals, reminders and progress against them |
| GET | `/analytics/recommendations` | Rule-based, with their evidence |
| POST | `/analytics/recommendations/explain` | AI explanation of those rules. Needs AI consent |
| GET | `/analytics/study-plan?days=` | Suggested schedule |
| POST | `/analytics/study-plan/apply` | Adds it to the planner, safe to repeat |
| GET | `/admin/analytics?days=` | Platform totals only (`dashboard.admin`). Revenue needs `payments.read` too. Averages from fewer than 5 students are withheld |

## Files, privacy and operations (built)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET, POST | `/reports` | Own | Lists files, or requests a progress report |
| GET | `/reports/:id/download` | Own | A short-lived link as JSON, or the file |
| GET | `/resources/:id/file` | Same as the resource | A short-lived link as JSON, or the file |
| PUT, DELETE | `/resources/:id/file?name=` | Manages the course | PDF, PNG or JPEG up to 25 MB, checked from real bytes |
| GET | `/privacy` | Own | Deletion state and retention periods |
| POST | `/privacy/export` | Own | Requests a data export |
| POST, DELETE | `/privacy/deletion` | Own | Schedules or cancels deletion. Students only |
| GET | `/admin/operations` | `operations.read` | Health, queues, workers, errors |
| GET | `/health/live`, `/health/ready` | Public | For load balancers |

## AI, tutor, consent and calibration (built)

All routes need a signed-in user. AI routes return 503 until their keys and Redis are set up, and 403 until the student has consented.

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET, PUT | `/consents` | User | Read or set `AI_PROCESSING`, `SPEECH_PROCESSING` or `CALIBRATION_USE`. Withdrawing speech consent deletes the student's recordings |
| POST | `/writing/submissions/:id/assessment` | `attempts.own` | Queue feedback, returning 202 and the job. Repeating it returns the same job |
| GET | `/writing/submissions/:id/assessment` | `attempts.own` | Job status and report. Bands are removed unless released |
| POST | `/speaking/submissions/:id/assessment` | `attempts.own` | Queue transcription and feedback |
| GET | `/speaking/submissions/:id/assessment` | `attempts.own` | Job, transcript, delivery measures and report. Never includes a band |
| DELETE | `/speaking/submissions/:id/audio` | `attempts.own` | Delete the audio. Written feedback stays |
| GET | `/ai/jobs/:id` | `attempts.own` | Job status |
| GET, POST | `/tutor/conversations` | `attempts.own` | List or start conversations |
| GET, DELETE | `/tutor/conversations/:id` | `attempts.own` | Read or delete one |
| POST | `/tutor/conversations/:id/messages` | `attempts.own` | Send a message, and stream the reply as server-sent events: `text`, `done`, `error` |
| POST | `/tutor/explain` | `attempts.own` | Short grammar, vocabulary or sentence explanation |
| GET, POST | `/admin/calibration/datasets` | `calibration.manage` (marks can list) | One dataset for each IELTS type and task |
| GET | `/admin/calibration/datasets/:id` | `calibration.manage` | Counts and runs |
| POST | `/admin/calibration/datasets/:id/samples` | `calibration.manage` | Add a de-identified sample |
| POST | `/admin/calibration/datasets/:id/approve-thresholds` | `assessments.review` | Instructor approval of the internal targets |
| GET | `/admin/calibration/datasets/:id/marking` | `calibration.mark` | Samples this marker hasn't marked, with no other marks shown |
| POST | `/admin/calibration/samples/:id/marks` | `calibration.mark` | One independent mark |
| GET | `/admin/calibration/datasets/:id/adjudication` | `calibration.manage` | Samples whose marks differ too much |
| POST | `/admin/calibration/samples/:id/adjudication` | `calibration.manage` | Final mark, from someone who didn't mark the sample |
| POST | `/admin/calibration/datasets/:id/freeze` | `calibration.manage` | Lock the dataset |
| POST | `/admin/calibration/datasets/:id/runs` | `calibration.manage` | Compare AI with human marks on a split |
| POST | `/admin/calibration/runs/:id/approve` | `assessments.review` | Instructor approval of a run |
| POST | `/admin/calibration/runs/:id/release` | `ai.band_release` | Set `HIDDEN`, `INTERNAL` or `PUBLIC` |
| GET | `/admin/ai/usage` | `ai.usage.read` | Tokens and cost. Filters: `from`, `to` |
| GET, PUT | `/admin/ai/models` | `ai.usage.read`, `ai.configure` | See or change the model for a task |

## Practice engine (built)

Every route needs a signed-in user. Student routes need `attempts.own`. Someone else's attempt returns 404. Files are streamed through the API after an access check, so no storage address is ever returned.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/exams` | Published exams. Filters: `search`, `examType`, `skill`, `isMock` |
| GET | `/exams/:examId` | Summary with no questions |
| POST | `/exams/:examId/attempts` | Start, or return the active attempt. Body: `{ "mode": "TIMED" }` or `PRACTICE`. Mock exams always use `MOCK` |
| GET | `/attempts` | History. Filter: `status` |
| GET | `/attempts/:attemptId` | State, section statuses and server time |
| POST | `/attempts/:attemptId/submit` | Submit everything. Safe to repeat |
| POST | `/attempts/:attemptId/cancel` | Cancel a practice or timed attempt |
| GET | `/attempts/:attemptId/result` | Raw scores, and review if allowed. Only after the attempt closes |
| POST | `/attempts/:attemptId/sections/:sectionId/start` | Start the section's timer. Repeating it keeps the same deadline |
| GET | `/attempts/:attemptId/sections/:sectionId` | Content and saved work. Never includes keys, explanations or transcripts |
| PUT | `/attempts/:attemptId/sections/:sectionId/answers` | Batch autosave, limited to 120 per minute per attempt |
| POST | `/attempts/:attemptId/sections/:sectionId/submit` | Finish one section. Safe to repeat |
| POST | `.../sections/:sectionId/audio/:audioId/play` | Count a play, enforcing the limit |
| GET | `.../sections/:sectionId/audio/:audioId` | Stream audio, after a play has been counted |
| GET | `.../sections/:sectionId/groups/:itemId/image`, `.../tasks/:itemId/image` | Stream a private image |
| PUT | `.../sections/:sectionId/writing/:taskId` | Save a writing draft |
| GET, DELETE | `/writing/submissions`, `/writing/submissions/:id` | Writing history. Filter: `status=draft` or `submitted`. Delete discards a draft only |
| PUT, GET, DELETE | `.../sections/:sectionId/speaking/:questionId/recording` | Upload (raw audio, `?durationSeconds=`), play back or remove a recording, up to 25 MB |
| GET | `/speaking/submissions` | Speaking history |

**Responses:** `{ "text": "library" }` for typed answers, or `{ "selected": ["A", "C"] }` using option labels.

**Errors:** `ATTEMPT_ALREADY_SUBMITTED` (409) and `ATTEMPT_EXPIRED` (410) mean the work is closed. Saved work is kept and marked.

**Scores:** raw marks only. `overallBand` and `bandScore` stay empty until a verified, versioned table exists. Writing and Speaking have no score until Phase 5 validation.

### Exam administration

Needs `content.write`. Publishing, archiving and removing an exam need `content.publish`. Changes to a published version return 409, and the database enforces this too.

| Method | Path | Purpose |
| --- | --- | --- |
| GET, POST | `/admin/exams` | List and create. Creating also makes draft version 1 |
| GET, PATCH, DELETE | `/admin/exams/:id` | Read, update, hide |
| POST | `/admin/exams/:id/versions` | Copy the newest published version into a new draft |
| GET, PATCH | `/admin/exam-versions/:id` | Full tree including keys, and settings: `navigation`, `reviewPolicy`, `resumeWindowHours`, `maxAttempts` |
| GET | `/admin/exam-versions/:id/validation` | Errors that block publishing, and warnings against the verified format |
| POST | `/admin/exam-versions/:id/publish`, `/archive` | Publish or archive |
| POST | `/admin/exam-versions/:id/sections` | Add a section. Settings: `maxAudioPlays`, `allowAudioSeek` |
| PATCH, DELETE | `/admin/exam-sections/:id` | Edit or remove |
| POST | `/admin/exam-sections/:id/passages`, `/groups`, `/writing-tasks`, `/speaking-questions` | Add content |
| PUT | `/admin/exam-sections/:id/audio?durationSeconds=` | Upload audio (raw, up to 100 MB) |
| GET, PATCH, DELETE | `/admin/audio/:id` | Play, set transcript, remove |
| PATCH, DELETE | `/admin/passages/:id`, `/admin/question-groups/:id`, `/admin/questions/:id`, `/admin/writing-tasks/:id`, `/admin/speaking-questions/:id` | Edit or remove |
| PUT | `/admin/question-groups/:id/image` | Upload a diagram, plan or map |
| POST | `/admin/question-groups/:id/questions` | Add a question with options and accepted answers |

> **Earlier proposal:** the `/papers` routes below were the Phase 0 design. The practice engine above replaced them.

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

## Later administration

Planned for later phases, and not implemented unless listed under Core platform. All paths start with `/admin`. All writes create an audit log entry.

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
