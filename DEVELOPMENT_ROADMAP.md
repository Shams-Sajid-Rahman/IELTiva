# IELTiva Development Roadmap

**Status:** Phases 0 to 2D are complete. Phase 3 (core platform) is built and awaits owner review. Phase 4 (IELTS practice engine) hasn't started.

Each phase ends with something testable and needs owner approval before the next begins. Durations are rough estimates for one full-time developer with AI assistance, and exclude content creation and marking.

## Summary

| Stage | Scope | Rough duration |
| --- | --- | --- |
| Phase 0 | Planning | Finishing |
| Release 1 | Phases 1 to 8 | About 3 months |
| Release 2 | Phases 9 to 13 | About 2.5 months |
| Release 3 | Phases 14 to 17 | Set after Release 2 data |

Three tracks run alongside development and **don't block** it:

| Track | Owner | Blocks |
| --- | --- | --- |
| A. Content and calibration | Owner, instructor, developer support | Public band scores only |
| B. Speech trial | Developer, instructor | The decision to build on Azure in Phase 9 |
| C. Legal and business | Owner | Public launch and final branding |

## Before Phase 1

- [x] Owner approves Phase 0
- [x] Set up isolated Node 24 and verify npm, Prisma and Vitest compatibility
- [x] Visually check the Mermaid diagrams
- [ ] Start trademark advice

## Release 1

### Phase 1: Frontend foundation

Authorized by the owner as design system and frontend architecture first, with no complete public website or dashboard.

- `.gitignore`, npm workspaces, `apps/web`, TypeScript, lint
- Next.js, Tailwind CSS, shadcn/ui, Framer Motion
- IELTiva brand tokens, light and dark themes, reusable accessible components, responsive layouts
- Internal design system page, component tests and screenshots

**Done when:** the app runs, components pass tests, layouts work on mobile, tablet and desktop, and the owner approves.

### Phase 1B: Backend foundation (1 week)

- Express, TypeScript and shared types in a layered API, with PostgreSQL, Prisma 7 and a first migration
- Validated environment, error handling, logging and health endpoints
- Backend tests and development scripts

**Done when:** a fresh clone runs web and API from documented commands, and tests pass against a real database.

**Moved out by owner scope:** Redis, the worker and continuous integration. They must be in place before Phase 5, and continuous integration should come first.

### Phase 2A: Database architecture

The complete PostgreSQL schema, migration, seed and tests, with no feature code.

**Done when:** migrations apply to an empty database, the seed is repeatable, constraints are tested and the owner approves.

### Phase 2B: Authentication backend

Registration, login, rotating sessions, email verification, password recovery, Google sign-in, access-control middleware and CSRF protection, with no frontend pages.

**Done when:** automated tests pass against an isolated database and the owner approves. Live email and Google checks need real credentials.

### Phase 2C: Frontend authentication

Sign-in pages, API client, session state, route guards and placeholder dashboards.

**Done when:** browser tests pass against the real API at every width and theme, and the owner approves.

### Public website, still to schedule

Authentication and dashboards are complete. The marketing pages below remain.

- Design system, public pages, metadata, sitemap and draft legal pages
- Band calculator and overall-band logic, tested with official examples
- Registration, verification, login, Google sign-in, password reset, roles
- Regions, locale and currency settings, onboarding and dashboard shell
- Account export and deletion requests, plus the retention job

**Done when:** a visitor can register and reach a dashboard. Tests cover token reuse, CSRF, rate limits and a deletion request end to end, and adding a test translation requires no code change.

### Phase 3: Core platform

Student and admin dashboards, user and role management, course and module management, enrollment, progress, profiles, sessions, notifications, history and audit logs.

**Done when:** backend, component and browser tests pass, and the owner approves.

### Phase 4: IELTS practice engine

- Listening, Reading, Writing and Speaking engines, plus full mock tests with configurable rules. Mock tests and Speaking recording moved here from Phases 6 and 9 at the owner's request
- Server-controlled timers, autosave, resume, and duplicate-safe submission
- Deterministic marking with raw scores only. No band conversion, because no verified table exists
- Writing drafts and submissions, with hidden assessment records prepared for Phase 5
- Exam authoring with provenance, validation, preview and immutable published versions
- Private files, streamed through the API after an access check

**Done when:** a student can complete a timed paper, survive a refresh and disconnection, and get correct results. Tests prove keys never reach the client before submission, and late answers are rejected.

**Still open:** production file storage needs the Cloudflare R2 provider, and real Listening recordings are needed from the content team.

### Phase 5: AI service and Writing Assessment (2 to 3 weeks)

- AI service, route table, Anthropic provider, usage events and price table
- BullMQ pipeline, prompts, schemas, retry and credit release
- Writing editor and report, with all three visibility states built from fixtures
- Band release gate, enforced in the API
- Calibration tables, marker interface and evaluation runner
- AI usage dashboard

**Done when:** changing a tier's model needs only configuration. A test proves no public response contains a band while the gate is closed. Every call appears with cost in the dashboard, and injection samples are handled.

**This phase doesn't wait for calibration results.** It finishes with bands hidden.

### Phase 6: Mock test refinement (1 week)

The mock test engine was built in Phase 4. What remains is real full-length content and any changes the instructor asks for.


- Mock builder, staged Listening, Reading and Writing flow, combined report

**Done when:** a mock survives an interruption at every stage, and the report shows section results with no overall four-skill band.

### Phase 7: Prepaid packages and payments (2 weeks)

- Products, regional prices, coupons, `PaymentGateway`, SSLCommerz sandbox
- Passes, credit ledger, expiry jobs and reminders, refunds, receipts

**Done when:** tests cover duplicate IPNs, forged callbacks, wrong amounts and closed browsers. A second fake gateway passes the same test suite without core changes. A small real payment and refund succeed with owner approval.

### Phase 8: Hardening and Release 1 launch (2 weeks)

- Security review, access-control tests on every endpoint, dependency audit
- Load test of autosave and queue, accessibility pass, backup restore test
- Re-verify IELTS facts against official sources
- Closed beta with final legal review, then launch

**Done when:** no critical or high findings remain open, and the owner approves launch. Writing launches with validated bands or as **feedback only**. Students never see unvalidated bands.

## Release 2

| Phase | Scope | Rough duration | Done when |
| --- | --- | --- | --- |
| 9 | Speech provider, transcripts and separate pronunciation feedback. Recording and upload were built in Phase 4 | 3 weeks | Works on desktop and mobile Chrome and Safari, failed uploads can be retried, and no band calculation reads pronunciation data |
| 10 | Three-criterion Speaking feedback, calibration runs, then Speaking in mocks | 2 weeks | No complete Speaking band appears until all four criteria are validated |
| 11 | AI IELTS Tutor with streaming and read-only tools | 1 to 2 weeks | Replies stream reliably and one student can't reach another's data |
| 12 | Personalized study plans | 1 week | Plans respect exam date and available hours |
| 13 | Advanced analytics | 1 to 2 weeks | Figures match source data in tests |

## Release 3

| Phase | Scope |
| --- | --- |
| 14 | Advanced calibration: drift monitoring, sampled human review, model comparison, more datasets |
| 15 | More learning content, and Bangla interface if demand supports it |
| 16 | International payments: gateway selection, tax handling, regional prices |
| 17 | Performance optimization based on production measurements |

## Track A: Content and calibration

| Step | Who | Timing | Output |
| --- | --- | --- | --- |
| Agree content standards and copyright rules | Owner, instructor | Before Phase 4 | Written guide |
| Write or review original seed papers and prompts | Instructor | During Phases 3 to 5 | At least 2 papers per skill and module used, and a prompt set |
| Review band conversion table and rubric wording | Instructor | Before Phase 5 | Approved versions |
| Collect consented Writing samples | Owner, instructor | Starts any time | De-identified samples in the agreed template, imported once Phase 5 tools exist |
| Blind double marking and adjudication | Instructor and a second independent qualified marker, arranged by the owner | After intake | Approved samples |
| Freeze dataset, run evaluation | Developer | After enough approved samples | Report per model, prompt and rubric |
| Tune on tuning split, confirm on the test split | Developer, instructor | Repeats | Passing run, or a decision to continue |
| Sign off and open band release | Instructor, owner | After a passing run | Public band scores |

**Sample template fields:** reference code, skill, task type, prompt, response, module, learner level, first language, region, consent version, and each marker's four criterion bands and notes. No names or contact details.

## Track B: Speech trial

**Goal:** decide whether Azure is useful for Bangladeshi learners before relying on it.

1. Obtain informed consent, and exclude minors or get guardian consent.
2. Collect recordings across low, middle and high speaking levels, across regional accents, and in quiet and typical home conditions. Aim for at least 50 speakers, a proposed figure for the instructor to adjust.
3. Run them through a small script, compare transcripts with human transcripts, and collect pronunciation measures.
4. Have the instructor review whether the feedback is accurate and fair.
5. Report transcript accuracy and feedback usefulness per group, plus real cost.

| Result | Action |
| --- | --- |
| Accurate and fair | Build Phase 9 on Azure |
| Good transcripts, unreliable pronunciation | Ship transcript-based feedback, leave pronunciation out or clearly experimental |
| Poor transcripts | Test another provider through `SpeechProvider` before Phase 9 |

## Track C: Legal and business

- Trademark advice on the name
- Privacy policy, terms, refund policy and AI disclaimer, with retention periods
- Minimum age and consent handling
- SSLCommerz merchant account
- Package names and prices, set from measured costs
- Provider data terms for Anthropic and Azure

## Main risks

| Risk | Response |
| --- | --- |
| Inaccurate AI bands | Hard gate, human-marked validation, estimate labels |
| Second marker not yet arranged | Development continues, formal calibration waits |
| Validation unfinished at launch | Feedback-only Writing, with packages sold on that basis |
| Too little test content | Instructor track runs from Phase 4 |
| Trademark or copyright complaint | Early advice, original content, provenance records |
| AI and speech costs exceed revenue | Usage tracking, credits, spend alerts, price from measurements |
| Azure unfair to local accents | Trial first, pronunciation kept separate from bands |
| Manual repurchase lowers retention | Reminders and longer passes |
| Deferred Speaking weakens the offer | Clear roadmap messaging, no promises in Release 1 packages |
