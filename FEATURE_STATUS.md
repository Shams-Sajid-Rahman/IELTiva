# Feature Status

For the owner and whoever runs final testing. "Built" means the code exists and passes type checks, lint and production builds. **Nothing from Phase 5 onward has been run**, so "Built" doesn't mean it works. IELTiva is not launch-ready.

| Area | Status | Still missing |
|---|---|---|
| Public website | Built | Published legal pages, a support or contact page, a public pricing page |
| Authentication | Built, tested in Phase 2 | The registration checkbox mentions terms and a privacy policy that aren't published yet |
| Student dashboard | Built | |
| Admin dashboard | Built | The "Reports" menu item is still a placeholder |
| Instructor functionality | Built | |
| Course management | Built | |
| Listening and Reading | Built | Real content. Raw scores only, because no verified band table exists |
| Writing and Speaking | Built | Real content |
| Mock examinations | Built | Real full-length content |
| AI assessment | Built, feedback only | API keys, a real trial, calibration data |
| AI tutor | Built | API key, a real trial |
| Payments | Built, sandbox only | Merchant accounts, a real sandbox trial, bKash, receipts, coupons |
| Analytics | Built | Band charts stay empty until real bands exist |
| Notifications | Built | Email needs a provider key |
| Infrastructure | Built | Redis, R2, hosting, a first real run of the worker |
| Security and privacy | Built | Independent security test, legal review |
| Beta controls | Built | A beta server, and your decision on who joins |

## Added in Phase 10

- **Instructors** can write exams and review each other's work. Before this, only editors and administrators could.
- **Publication approval:** a second person must approve an exam version before it's published. This is always on for beta and production servers.
- **Instructor review of student work**, at **Admin → IELTS assessments**. It's the only source of "instructor reviewed" scores.
- **Speaking calibration** now has recordings, because marking from a transcript alone wouldn't be valid.
- **Pronunciation check:** compares the speech service's measure with what markers heard. It's evidence only and can't release a band.
- **Release controls:** feature switches, private beta list, feedback, incident records, maintenance message.
- **Staff alerts** inside the app for known problems.

## Waiting on people, not code

| Needed | From |
|---|---|
| Original or licensed exam content | Owner, instructors |
| Approval of the rubrics and calibration targets | Instructor |
| At least two qualified markers, plus an adjudicator | Owner |
| Consented Writing and Speaking samples | Owner, instructors |
| A verified Listening and Reading band table, if you want bands | Instructor |
| Legal review, starting with where data may be stored | Lawyer |
| Prices and a refund policy | Owner |
| Sandbox and later live accounts | Owner |
| Hosting, Redis, R2, email, backups | Owner |

## Open decisions

1. Keep or remove the "Reports" menu item. Analytics covers most of what it promised.
2. Should AI feedback use credits (`billing.enforce_credits`)? It's off today, so it's free.
3. Should an instructor review cost a credit? It's free today, with a limit of three requests a day per student.
