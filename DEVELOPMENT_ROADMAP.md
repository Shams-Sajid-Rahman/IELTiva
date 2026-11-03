# IELTiva Development Roadmap

**Status:** Phases 0 and 1 approved, with visual direction provisional. Phase 1B (backend foundation) is complete. Phase 2A (database architecture) is built and awaits owner review. Phase 2B hasn't started.

Each phase ends with something testable and needs owner approval before the next begins. Durations are rough estimates for one full-time developer with AI assistance, and exclude content creation and marking.

## Summary

| Stage | Scope | Rough duration |
| --- | --- | --- |
| Phase 0 | Planning | Finishing |
| Release 1 | Phases 1 to 7 | About 3 months |
| Release 2 | Phases 8 to 12 | About 2.5 months |
| Release 3 | Phases 13 to 16 | Set after Release 2 data |

Three tracks run alongside development and **don't block** it:

| Track | Owner | Blocks |
| --- | --- | --- |
| A. Content and calibration | Owner, instructor, developer support | Public band scores only |
| B. Speech trial | Developer, instructor | The decision to build on Azure in Phase 8 |
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

**Moved out by owner scope:** Redis, the worker and continuous integration. They must be in place before Phase 4, and continuous integration should come first.

### Phase 2A: Database architecture

The complete PostgreSQL schema, migration, seed and tests, with no feature code.

**Done when:** migrations apply to an empty database, the seed is repeatable, constraints are tested and the owner approves.

### Phase 2: Public website, authentication and dashboard (2 weeks)

- Design system, public pages, metadata, sitemap and draft legal pages
- Band calculator and overall-band logic, tested with official examples
- Registration, verification, login, Google sign-in, password reset, roles
- Regions, locale and currency settings, onboarding and dashboard shell
- Account export and deletion requests, plus the retention job

**Done when:** a visitor can register and reach a dashboard. Tests cover token reuse, CSRF, rate limits and a deletion request end to end, and adding a test translation requires no code change.

### Phase 3: Content system, Listening and Reading (3 weeks)

- Private storage and presigned URLs
- Paper authoring with provenance, review and versioning, and validation against verified formats
- Exam player with server timer, autosave, resume and audio
- Marking, band conversion, review page and basic progress view

**Done when:** a student can complete a timed paper, survive a refresh and disconnection, and get correct results. Tests prove keys never reach the client before submission, and late answers are rejected.

### Phase 4: AI service and Writing Assessment (2 to 3 weeks)

- AI service, route table, Anthropic provider, usage events and price table
- BullMQ pipeline, prompts, schemas, retry and credit release
- Writing editor and report, with all three visibility states built from fixtures
- Band release gate, enforced in the API
- Calibration tables, marker interface and evaluation runner
- AI usage dashboard

**Done when:** changing a tier's model needs only configuration. A test proves no public response contains a band while the gate is closed. Every call appears with cost in the dashboard, and injection samples are handled.

**This phase doesn't wait for calibration results.** It finishes with bands hidden.

### Phase 5: Basic mock tests (1 week)

- Mock builder, staged Listening, Reading and Writing flow, combined report

**Done when:** a mock survives an interruption at every stage, and the report shows section results with no overall four-skill band.

### Phase 6: Prepaid packages and payments (2 weeks)

- Products, regional prices, coupons, `PaymentGateway`, SSLCommerz sandbox
- Passes, credit ledger, expiry jobs and reminders, refunds, receipts

**Done when:** tests cover duplicate IPNs, forged callbacks, wrong amounts and closed browsers. A second fake gateway passes the same test suite without core changes. A small real payment and refund succeed with owner approval.

### Phase 7: Hardening and Release 1 launch (2 weeks)

- Security review, access-control tests on every endpoint, dependency audit
- Load test of autosave and queue, accessibility pass, backup restore test
- Re-verify IELTS facts against official sources
- Closed beta with final legal review, then launch

**Done when:** no critical or high findings remain open, and the owner approves launch. Writing launches with validated bands or as **feedback only**. Students never see unvalidated bands.

## Release 2

| Phase | Scope | Rough duration | Done when |
| --- | --- | --- | --- |
| 8 | Speaking recording, upload, speech provider, transcripts and separate pronunciation feedback | 3 weeks | Works on desktop and mobile Chrome and Safari, failed uploads can be retried, and no band calculation reads pronunciation data |
| 9 | Three-criterion Speaking feedback, calibration runs, then Speaking in mocks | 2 weeks | No complete Speaking band appears until all four criteria are validated |
| 10 | AI IELTS Tutor with streaming and read-only tools | 1 to 2 weeks | Replies stream reliably and one student can't reach another's data |
| 11 | Personalized study plans | 1 week | Plans respect exam date and available hours |
| 12 | Advanced analytics | 1 to 2 weeks | Figures match source data in tests |

## Release 3

| Phase | Scope |
| --- | --- |
| 13 | Advanced calibration: drift monitoring, sampled human review, model comparison, more datasets |
| 14 | More learning content, and Bangla interface if demand supports it |
| 15 | International payments: gateway selection, tax handling, regional prices |
| 16 | Performance optimization based on production measurements |

## Track A: Content and calibration

| Step | Who | Timing | Output |
| --- | --- | --- | --- |
| Agree content standards and copyright rules | Owner, instructor | Before Phase 3 | Written guide |
| Write or review original seed papers and prompts | Instructor | During Phases 3 to 5 | At least 2 papers per skill and module used, and a prompt set |
| Review band conversion table and rubric wording | Instructor | Before Phase 4 | Approved versions |
| Collect consented Writing samples | Owner, instructor | Starts any time | De-identified samples in the agreed template, imported once Phase 4 tables exist |
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
| Accurate and fair | Build Phase 8 on Azure |
| Good transcripts, unreliable pronunciation | Ship transcript-based feedback, leave pronunciation out or clearly experimental |
| Poor transcripts | Test another provider through `SpeechProvider` before Phase 8 |

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
| Too little test content | Instructor track runs from Phase 3 |
| Trademark or copyright complaint | Early advice, original content, provenance records |
| AI and speech costs exceed revenue | Usage tracking, credits, spend alerts, price from measurements |
| Azure unfair to local accents | Trial first, pronunciation kept separate from bands |
| Manual repurchase lowers retention | Reminders and longer passes |
| Deferred Speaking weakens the offer | Clear roadmap messaging, no promises in Release 1 packages |
