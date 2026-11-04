# Final System Test Checklist

For whoever runs final testing **after Phase 11**. Nothing here has been run yet. Mark each item PASS, FAIL, BLOCKED or NOT RUN, and only mark PASS if it actually ran and succeeded. Use a staging server, sandbox payments and test accounts. Don't use real student data.

## Before starting

- [ ] Redis, the worker, R2 or local storage, email, sandbox gateways, Anthropic and Azure test keys are ready
- [ ] Existing test suites run (`npm test`, `npm run test:db`). They weren't run for Phases 5 to 10 and may need updating
- [ ] New automated tests are written for payments, credits, refunds, deletion and export
- [ ] Sample content exists for every skill and both IELTS types

## Student workflows

- [ ] Register, verify email, sign in, sign out, reset password
- [ ] Google sign-in and linking
- [ ] Profile, photo, preferences, sessions
- [ ] Browse, enroll, open a lesson, complete a course, download an attached file
- [ ] Notifications
- [ ] Goals, reminders at the right local time, suggested schedule added once only
- [ ] Analytics match real results, and empty states appear with no data
- [ ] Raw, estimated and reviewed scores are clearly different

## Admin and instructor workflows

- [ ] Each role sees and can do only what it should: Student, Instructor, Marker, Editor, Admin, Super admin
- [ ] Hidden pages are also refused when requested directly
- [ ] Course creation and publishing
- [ ] Exam: write → send for review → second person approves → publish
- [ ] An author can't approve their own version, and an unapproved version can't publish on a beta server
- [ ] Editing is blocked during review, and withdrawing ends approval
- [ ] Instructor review: blind to the student's name, and can't review your own work
- [ ] Settings and audit log, feature switches, beta list, feedback, incidents
- [ ] Admin analytics show no individual students, and small groups are withheld

## IELTS modules

- [ ] **Listening:** audio plays, play limits hold, every question type, marking and alternative answers
- [ ] **Reading:** passages, every question type, highlighting if available, marking
- [ ] **Writing:** autosave, word count, timer, submission, Academic and General tasks
- [ ] **Speaking:** microphone permission, recording, replace, upload, all three parts, invalid file handling
- [ ] Timers survive refresh, and expired sections close correctly
- [ ] Answers aren't visible before an attempt is finished

## Full mock examinations

- [ ] One complete Academic mock and one General Training mock, start to finish
- [ ] Interruption at each stage: refresh, lost network, closed browser, resume
- [ ] Result shows section results and no invented overall band

## AI assessment

- [ ] Consent is requested first, and withdrawing it works
- [ ] Writing feedback for each task type, and quotes really appear in the essay
- [ ] Speaking transcript, three-criterion feedback, and pronunciation measures labelled experimental
- [ ] **No AI band appears for students unless released**
- [ ] **Speaking AI band can't be released**
- [ ] Prompt injection attempts in essays don't change results
- [ ] Failures: bad API key, timeout, worker stopped, Redis stopped. Credit returned on failure
- [ ] Repeat requests don't charge twice
- [ ] Calibration end to end: two markers, adjudication, freeze, run, approval, release blockers
- [ ] Speaking samples can't freeze without recordings, and the pronunciation check runs

## AI tutor

- [ ] Streaming, history, deleting a conversation, daily limit
- [ ] Won't give answers during an open exam, and explains them after
- [ ] Prompt injection and attempts to reveal instructions
- [ ] Personal details are removed before sending

## Payments and entitlements

- [ ] Sandbox payment succeeds on each gateway you plan to use
- [ ] Failed, cancelled, abandoned and closed-browser payments
- [ ] Forged success return, forged and replayed notifications, wrong amount and wrong currency: nothing is granted
- [ ] Double click and two tabs
- [ ] A notification that never arrives: status page and sweep still settle it
- [ ] Confirm the unchecked gateway details listed in `PAYMENTS.md`
- [ ] Refund: request, approve, reject, partial, full, manual, over-refund refused
- [ ] Credits granted, used, expired, revoked after a full refund
- [ ] Two simultaneous uses of the last credit: only one succeeds
- [ ] Premium content locked and unlocked correctly
- [ ] `billing.enforce_credits` on and off
- [ ] Revenue figures match gateway records exactly, per currency

## Responsive UI and accessibility

- [ ] Phone (360 px), tablet and desktop for every page, with no sideways scrolling
- [ ] Light and dark modes
- [ ] Keyboard only, screen reader spot checks, reduced motion
- [ ] Chrome, Firefox, Safari and Android Chrome. Recording works on each
- [ ] Slow connection

## Authentication and security

- [ ] Lockout, rate limits, and limits holding across two API servers
- [ ] Refresh token reuse ends the session
- [ ] CSRF: requests without a token are refused
- [ ] Another student's records: attempts, recordings, reports, purchases and conversations by ID (IDOR)
- [ ] XSS through every free-text field, including feedback and reviews
- [ ] File uploads: wrong type, renamed file, oversized file
- [ ] Beta list: unlisted people can't register or sign in, staff can, and removal ends sessions
- [ ] Independent penetration test
- [ ] Browser reports reviewed before enforcing the content security policy

## Privacy

- [ ] Data export is complete and only holds that person's data
- [ ] Account deletion: request, cancel, then complete. All files and rows gone, and payments kept without identity
- [ ] Recording deleted on request, on consent withdrawal and after the retention period, including from storage
- [ ] Generated files expire and are removed
- [ ] Logs contain no passwords, tokens, card details or student work

## Performance

- [ ] Load test: autosave during a full mock with many students
- [ ] Queue under load, and API latency on analytics pages
- [ ] Database connections stay within limits
- [ ] Web page load on a mid-range phone

## Backup and recovery

- [ ] Restore a backup to a new server and sign in
- [ ] Roll back a release
- [ ] Apply migrations to a copy of real-sized data
- [ ] Worker restart during a job: no duplicate charge or result
- [ ] Redis and storage outage: the app stays up and recovers
- [ ] Alerts arrive, including the outside uptime monitor
- [ ] Feature switches take effect, with the server enforcing them

## Sign-off

Each is a real person's decision, recorded with a name and date: instructor, owner, lawyer, security tester.
