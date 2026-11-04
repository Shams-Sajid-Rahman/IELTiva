# Release Notes

For the owner and staff. Nothing has been released to users. These describe what's in the code.

## Unreleased: Phases 5 to 10

**Status: not tested and not released.** Everything below passes type checks, lint and builds, but hasn't been run.

### Students
- AI Writing and Speaking feedback, with no unvalidated bands
- AI tutor
- Prepaid packages, credits, purchase history and refund requests
- Progress analytics, goals, reminders, recommendations and suggested schedules
- Downloadable progress reports
- Data export and account deletion
- Asking an instructor to review work, and sending feedback

### Staff
- Human calibration for Writing and Speaking
- Package, payment, refund, revenue and gateway management (sandbox only)
- Platform analytics and System health
- Exam publication approval by a second person
- Review of student work
- Release controls: switches, beta list, feedback and incidents

### Infrastructure
- Background worker, private R2 storage, audio checks, caching, health endpoints, alerts

### Things to do when deploying
- 6 database migrations apply. All add to what exists, and none removes data
- Run the seed to add new permissions
- Instructors gain permission to write and review exams
- New settings are listed in `.env.example`

### Known issues
See `FEATURE_STATUS.md` and the known gaps in `SECURITY.md` and `PAYMENTS.md`.

Add a new section here for each real release, with its date and version.
