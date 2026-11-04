# Content and Calibration Workflow

For instructors, markers and content staff. It explains how content and AI checks move from draft to students. Nothing has been approved so far, and an approval only exists once a real person records it in the app.

## Rules for all content

- Use only content that's original, licensed or otherwise authorized. **Never copy Cambridge or other published IELTS material without written permission.**
- Record where it came from on each exam version. Licensed content needs a source note.
- AI-assisted content counts only after a person has reviewed it.
- Academic and General Training are separate. Don't reuse a task across them unless it's written for both.

## Exams: from draft to students

Go to **Admin → Exams**.

| Step | Who | What happens |
|---|---|---|
| 1. Write | Instructor or editor | Add sections and content, then check the validation panel |
| 2. Send for review | Author | Checks run again, and the version locks |
| 3. Review | A **different** person with review permission | Approve, or request changes with a note |
| 4. Publish | Administrator | Students get this version. Older versions stay for attempts that used them |

- Taking a version back from review to edit it ends any approval, so what's approved is always what's published.
- Published versions never change. To correct one, create a new version.
- This review is required on beta and production servers. On a development server, it's a switch in **Release controls**.

### What to check per skill

| Skill | Check |
|---|---|
| Listening | Audio is clear and original or licensed, transcript matches, each question has every accepted answer |
| Reading | Passage rights, correct question types, answer key, spelling and alternative answers |
| Writing | Prompt suits the IELTS type and task, word minimum, charts or letters fit Task 1 |
| Speaking | Parts 1, 2 and 3, cue card for Part 2, sensible timing |
| Mock | All sections present, timing, order, and nothing repeated from practice sets |

## AI calibration

AI band scores stay hidden from students until this is complete. The targets below are IELTiva's internal targets and need instructor approval. They aren't official IELTS standards:

- 200 samples per dataset
- Average error of 0.5 band or less
- At least 90% within one band

Go to **Admin → Calibration**.

| Step | Who | Rule |
|---|---|---|
| 1. Create a dataset | Calibration manager | One per IELTS type and task, never pooled: Academic Task 1, General Task 1, Academic Task 2, General Task 2 |
| 2. Approve targets | Instructor | Recorded with their name |
| 3. Add samples | Calibration manager | Consented and with personal details removed, placed in Tuning, Validation or Test |
| 4. Mark independently | Two qualified markers | Neither sees the other's mark. The system treats anyone with the Marker role as qualified, so give that role carefully |
| 5. Adjudicate | Someone who didn't mark that sample | Only when the two marks differ by more than the tolerance |
| 6. Freeze | Calibration manager | Nothing in the dataset can change afterward |
| 7. Compare with AI | Calibration manager | Run on Validation, then on Test once |
| 8. Approve the run | Instructor | |
| 9. Release | Instructor and owner | Public release is refused unless the dataset is frozen, the targets are approved, the Test run passes and it's approved |

Don't tune prompts using Test samples. A changed model or prompt closes the release for that combination, so it has to pass again.

## Speaking

- Each sample needs a **recording**. A dataset can't freeze without them.
- Mark what you hear. The transcript is a machine's and can be wrong, and pronunciation can't be judged from it.
- **Speaking AI bands stay disabled.** The system refuses to release them, and that's deliberate. The AI gives feedback on three criteria and doesn't assess pronunciation.

### Pronunciation check

On a frozen Speaking dataset, **Check pronunciation measures** compares the speech service's score with your markers' Pronunciation marks and reports a correlation.

This is evidence for instructors to discuss, and nothing more. It can't release a band and doesn't turn a measure into a band. Before relying on it, instructors should also check fairness for Bangladeshi and other accents.

## Reviewing student work

Students can ask for an instructor's review at **Admin → IELTS assessments**.

- You see the work and not the student's name. You can't review your own work.
- An overall band needs a score for every criterion. Notes and part-scores are fine by themselves.
- Pronunciation can only be scored while the recording exists. Recordings are deleted after 90 days by default.
- Students see this labelled as an instructor review and not an official IELTS result.
