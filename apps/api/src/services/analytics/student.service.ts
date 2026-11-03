import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { pageMeta } from "../../utils/api-response.js";
import type { Cache } from "../cache.js";

const DAY = 86_400_000;
const CACHE_SECONDS = 60;
/** A question type needs this many answers before it's called a strength or a weakness. */
export const MIN_TYPE_ANSWERS = 5;

export const SKILLS = ["LISTENING", "READING", "WRITING", "SPEAKING"] as const;
export type SkillName = (typeof SKILLS)[number];

export type SkillStats = {
  skill: SkillName;
  sectionsCompleted: number;
  sectionsTimedOut: number;
  /** Raw score totals. Null means nothing was marked, which is different from zero. */
  rawScore: number | null;
  maxScore: number | null;
  accuracy: number | null;
  minutes: number;
  lastPracticedAt: string | null;
};

export type BandPoint = { date: string; skill: SkillName | "OVERALL"; band: number; kind: "ESTIMATED" | "REVIEWED"; source: string };

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const roundBand = (value: number) => Math.round(value * 10) / 10;

export function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function dayInZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Longest run of consecutive days in a list of ISO dates. */
export function longestStreak(days: string[]) {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let previous = 0;
  for (const day of sorted) {
    const time = new Date(`${day}T00:00:00Z`).getTime();
    run = time - previous === DAY ? run + 1 : 1;
    best = Math.max(best, run);
    previous = time;
  }
  return best;
}

/** Consecutive active days ending today or yesterday. */
export function currentStreak(days: string[], today: string) {
  const seen = new Set(days);
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!seen.has(today)) cursor.setTime(cursor.getTime() - DAY);
  let streak = 0;
  while (seen.has(isoDay(cursor))) {
    streak += 1;
    cursor.setTime(cursor.getTime() - DAY);
  }
  return streak;
}

/**
 * Everything here is read from the student's own stored records. Anything missing comes back as null or an
 * empty list, so a screen can say "no data yet" and never has to guess.
 *
 * Three kinds of number are kept apart:
 *   raw:       marked answers (a score out of a maximum, and the accuracy worked out from it)
 *   estimated: a band stored on a result, or an AI band that has passed the calibration release gate
 *   reviewed:  a score a human instructor has confirmed
 * Listening and Reading have no verified raw-to-band table, so nothing is converted here.
 */
export function createStudentAnalyticsService(prisma: PrismaClient, cache: Cache) {
  async function timeZoneOf(userId: string) {
    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { timezone: true } });
    return profile?.timezone ?? "UTC";
  }

  async function skillStats(userId: string, since: Date): Promise<SkillStats[]> {
    const rows = await prisma.$queryRaw<{ skill: SkillName; completed: bigint; timed_out: bigint; raw: bigint | null; max: bigint | null; seconds: bigint | null; last_at: Date | null }[]>`
      SELECT s.skill::text AS skill,
             COUNT(*) FILTER (WHERE sa.status IN ('SUBMITTED', 'EXPIRED'))::bigint AS completed,
             COUNT(*) FILTER (WHERE sa.status = 'EXPIRED')::bigint AS timed_out,
             SUM(sa.raw_score) FILTER (WHERE sa.status IN ('SUBMITTED', 'EXPIRED') AND sa.max_score > 0)::bigint AS raw,
             SUM(sa.max_score) FILTER (WHERE sa.status IN ('SUBMITTED', 'EXPIRED') AND sa.max_score > 0)::bigint AS max,
             SUM(sa.time_spent_seconds) FILTER (WHERE sa.status IN ('SUBMITTED', 'EXPIRED'))::bigint AS seconds,
             MAX(sa.submitted_at) AS last_at
      FROM section_attempts sa
      JOIN exam_sections s ON s.id = sa.section_id
      JOIN exam_attempts a ON a.id = sa.exam_attempt_id
      WHERE a.user_id = ${userId}::uuid AND a.status <> 'ABANDONED' AND a.created_at >= ${since}
      GROUP BY s.skill`;
    const bySkill = new Map(rows.map((row) => [row.skill, row]));
    return SKILLS.map((skill) => {
      const row = bySkill.get(skill);
      const raw = row?.raw === null || row?.raw === undefined ? null : Number(row.raw);
      const max = row?.max === null || row?.max === undefined ? null : Number(row.max);
      return {
        skill,
        sectionsCompleted: Number(row?.completed ?? 0),
        sectionsTimedOut: Number(row?.timed_out ?? 0),
        rawScore: raw,
        maxScore: max,
        accuracy: raw !== null && max !== null ? percent(raw, max) : null,
        minutes: Math.round(Number(row?.seconds ?? 0) / 60),
        lastPracticedAt: row?.last_at ? row.last_at.toISOString() : null,
      };
    });
  }

  /** Accuracy for each skill by week, in the student's own time zone. A week with nothing marked is simply absent. */
  async function weeklyAccuracy(userId: string, since: Date, timeZone: string) {
    const rows = await prisma.$queryRaw<{ week: Date; skill: SkillName; raw: bigint; max: bigint; sections: bigint }[]>`
      SELECT date_trunc('week', sa.submitted_at AT TIME ZONE ${timeZone}::text) AS week, s.skill::text AS skill,
             SUM(sa.raw_score)::bigint AS raw, SUM(sa.max_score)::bigint AS max, COUNT(*)::bigint AS sections
      FROM section_attempts sa
      JOIN exam_sections s ON s.id = sa.section_id
      JOIN exam_attempts a ON a.id = sa.exam_attempt_id
      WHERE a.user_id = ${userId}::uuid AND sa.status IN ('SUBMITTED', 'EXPIRED') AND sa.max_score > 0 AND sa.submitted_at >= ${since}
      GROUP BY 1, 2
      ORDER BY 1`;
    return rows.map((row) => ({ week: isoDay(row.week), skill: row.skill, accuracy: percent(Number(row.raw), Number(row.max)) ?? 0, sections: Number(row.sections) }));
  }

  async function questionTypes(userId: string, since: Date) {
    const rows = await prisma.$queryRaw<{ type: string; skill: SkillName; total: bigint; correct: bigint }[]>`
      SELECT g.type::text AS type, s.skill::text AS skill, COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE r.is_correct)::bigint AS correct
      FROM question_responses r
      JOIN questions q ON q.id = r.question_id
      JOIN question_groups g ON g.id = q.group_id
      JOIN section_attempts sa ON sa.id = r.section_attempt_id
      JOIN exam_sections s ON s.id = sa.section_id
      JOIN exam_attempts a ON a.id = sa.exam_attempt_id
      WHERE a.user_id = ${userId}::uuid AND a.status IN ('SUBMITTED', 'EXPIRED') AND r.is_correct IS NOT NULL AND a.created_at >= ${since}
      GROUP BY 1, 2`;
    return rows
      .map((row) => ({ type: row.type, skill: row.skill, total: Number(row.total), correct: Number(row.correct), accuracy: percent(Number(row.correct), Number(row.total)) ?? 0, enoughData: Number(row.total) >= MIN_TYPE_ANSWERS }))
      .sort((a, b) => a.accuracy - b.accuracy);
  }

  /** One row per active day, combining exam practice and course activity. */
  async function dailyActivity(userId: string, since: Date, timeZone: string) {
    const rows = await prisma.$queryRaw<{ day: Date; minutes: bigint; sessions: bigint }[]>`
      SELECT day, SUM(minutes)::bigint AS minutes, SUM(sessions)::bigint AS sessions FROM (
        SELECT date_trunc('day', sa.submitted_at AT TIME ZONE ${timeZone}::text) AS day, ROUND(SUM(sa.time_spent_seconds) / 60.0)::bigint AS minutes, COUNT(*)::bigint AS sessions
        FROM section_attempts sa JOIN exam_attempts a ON a.id = sa.exam_attempt_id
        WHERE a.user_id = ${userId}::uuid AND sa.submitted_at >= ${since}
        GROUP BY 1
        UNION ALL
        SELECT date_trunc('day', h.occurred_at AT TIME ZONE ${timeZone}::text) AS day, COALESCE(SUM(h.minutes), 0)::bigint AS minutes, COUNT(*)::bigint AS sessions
        FROM user_learning_history h
        WHERE h.user_id = ${userId}::uuid AND h.occurred_at >= ${since} AND h.event_type NOT IN ('ENROLLED', 'ENROLLMENT_CANCELED')
        GROUP BY 1
      ) activity
      GROUP BY day
      ORDER BY day`;
    return rows.map((row) => ({ day: isoDay(row.day), minutes: Number(row.minutes), sessions: Number(row.sessions) }));
  }

  /**
   * Bands the student is allowed to see, and nothing else: stored band scores, human-reviewed results, and AI Writing
   * bands whose exact model and prompt passed the release gate. Speaking AI bands are never included.
   */
  async function bandPoints(userId: string, since: Date): Promise<{ points: BandPoint[]; criteria: { skill: "WRITING" | "SPEAKING"; criterion: string; average: number; samples: number; kind: "ESTIMATED" | "REVIEWED" }[] }> {
    const [sections, attempts, results, releases] = await Promise.all([
      prisma.sectionAttempt.findMany({ where: { bandScore: { not: null }, submittedAt: { gte: since }, examAttempt: { userId } }, select: { bandScore: true, submittedAt: true, section: { select: { skill: true, title: true } } }, orderBy: { submittedAt: "asc" } }),
      prisma.examAttempt.findMany({ where: { userId, overallBand: { not: null }, submittedAt: { gte: since } }, select: { overallBand: true, submittedAt: true, examVersion: { select: { exam: { select: { title: true } } } } }, orderBy: { submittedAt: "asc" } }),
      prisma.assessmentResult.findMany({
        where: {
          isCurrent: true,
          createdAt: { gte: since },
          OR: [
            { writingSubmission: { sectionAttempt: { examAttempt: { userId } } } },
            { speakingSubmission: { sectionAttempt: { examAttempt: { userId } } } },
          ],
        },
        select: {
          overallBand: true,
          createdAt: true,
          reviewedById: true,
          modelConfigurationId: true,
          promptVersionId: true,
          speakingSubmissionId: true,
          criterionScores: { select: { criterion: true, band: true } },
          writingSubmission: { select: { writingTask: { select: { taskType: true } }, sectionAttempt: { select: { examAttempt: { select: { examVersion: { select: { exam: { select: { examType: true } } } } } } } } } },
        },
      }),
      prisma.bandRelease.findMany({ where: { visibility: "PUBLIC" }, select: { modelConfigurationId: true, promptVersionId: true, examType: true, taskType: true } }),
    ]);

    const released = (row: (typeof results)[number]) => {
      const examType = row.writingSubmission?.sectionAttempt.examAttempt.examVersion.exam.examType;
      const taskType = row.writingSubmission?.writingTask.taskType;
      return Boolean(examType && taskType && releases.some((item) => item.modelConfigurationId === row.modelConfigurationId && item.promptVersionId === row.promptVersionId && item.examType === examType && item.taskType === taskType));
    };

    const points: BandPoint[] = [
      ...sections.map((row) => ({ date: row.submittedAt!.toISOString(), skill: row.section.skill as SkillName, band: Number(row.bandScore), kind: "ESTIMATED" as const, source: row.section.title })),
      ...attempts.map((row) => ({ date: row.submittedAt!.toISOString(), skill: "OVERALL" as const, band: Number(row.overallBand), kind: "ESTIMATED" as const, source: row.examVersion.exam.title })),
    ];

    const totals = new Map<string, { skill: "WRITING" | "SPEAKING"; criterion: string; kind: "ESTIMATED" | "REVIEWED"; sum: number; samples: number }>();
    for (const row of results) {
      const speaking = Boolean(row.speakingSubmissionId);
      const reviewed = row.reviewedById !== null;
      // A Speaking result only counts once a human has reviewed it. An unreviewed AI Speaking band is never shown.
      if (!reviewed && (speaking || !released(row))) continue;
      const kind = reviewed ? ("REVIEWED" as const) : ("ESTIMATED" as const);
      const skill = speaking ? ("SPEAKING" as const) : ("WRITING" as const);
      const hasPronunciation = row.criterionScores.some((score) => score.criterion === "PRONUNCIATION");
      // A whole Speaking band needs all four criteria, including a real pronunciation assessment.
      if (row.overallBand !== null && (!speaking || hasPronunciation)) points.push({ date: row.createdAt.toISOString(), skill, band: Number(row.overallBand), kind, source: reviewed ? "Instructor review" : "Released AI estimate" });
      for (const score of row.criterionScores) {
        const key = `${skill}:${score.criterion}:${kind}`;
        const total = totals.get(key) ?? { skill, criterion: score.criterion, kind, sum: 0, samples: 0 };
        total.sum += Number(score.band);
        total.samples += 1;
        totals.set(key, total);
      }
    }
    return {
      points: points.sort((a, b) => a.date.localeCompare(b.date)),
      criteria: [...totals.values()].map((row) => ({ skill: row.skill, criterion: row.criterion, kind: row.kind, samples: row.samples, average: roundBand(row.sum / row.samples) })),
    };
  }

  /** Writing and Speaking activity that doesn't depend on any band: counts, length and what feedback keeps pointing out. */
  async function productionSkills(userId: string, since: Date) {
    const owned = { sectionAttempt: { examAttempt: { userId, createdAt: { gte: since } } } };
    const [writing, speaking, feedback] = await Promise.all([
      prisma.writingSubmission.aggregate({ where: { ...owned, submittedAt: { not: null } }, _count: { _all: true }, _avg: { wordCount: true } }),
      prisma.speakingSubmission.findMany({ where: { ...owned, submittedAt: { not: null } }, select: { durationSeconds: true, fluencyMetrics: true }, take: 500 }),
      prisma.assessmentFeedback.findMany({
        where: {
          type: "CORRECTION",
          result: { isCurrent: true, createdAt: { gte: since }, OR: [{ writingSubmission: { sectionAttempt: { examAttempt: { userId } } } }, { speakingSubmission: { sectionAttempt: { examAttempt: { userId } } } }] },
        },
        select: { evidence: true, resultId: true },
        take: 2_000,
      }),
    ]);
    const speeds = speaking.map((row) => (row.fluencyMetrics as { wordsPerMinute?: number } | null)?.wordsPerMinute).filter((value): value is number => typeof value === "number");
    const kindOf = (row: { evidence: unknown }) => (row.evidence as { kind?: string } | null)?.kind;
    return {
      writing: { submissions: writing._count._all, averageWords: writing._avg.wordCount === null ? null : Math.round(writing._avg.wordCount) },
      speaking: {
        recordings: speaking.length,
        totalMinutes: Math.round(speaking.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0) / 60),
        averageWordsPerMinute: speeds.length ? Math.round(speeds.reduce((sum, value) => sum + value, 0) / speeds.length) : null,
      },
      feedbackFocus: {
        results: new Set(feedback.map((row) => row.resultId)).size,
        grammarCorrections: feedback.filter((row) => kindOf(row) === "grammar").length,
        vocabularySuggestions: feedback.filter((row) => kindOf(row) === "vocabulary").length,
      },
    };
  }

  async function build(userId: string, days: number) {
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY);
    const timeZone = await timeZoneOf(userId);
    const [skills, weekly, types, activity, bands, production, attemptCounts, profile] = await Promise.all([
      skillStats(userId, since),
      weeklyAccuracy(userId, since, timeZone),
      questionTypes(userId, since),
      dailyActivity(userId, since, timeZone),
      bandPoints(userId, since),
      productionSkills(userId, since),
      prisma.examAttempt.groupBy({ by: ["status", "mode"], where: { userId, createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.userProfile.findUnique({ where: { userId }, select: { targetBand: true, examDate: true } }),
    ]);

    const count = (test: (row: (typeof attemptCounts)[number]) => boolean) => attemptCounts.filter(test).reduce((sum, row) => sum + row._count._all, 0);
    const finished = count((row) => row.status === "SUBMITTED");
    const timedOut = count((row) => row.status === "EXPIRED");
    const abandoned = count((row) => row.status === "ABANDONED");
    const today = dayInZone(now, timeZone);
    const activeDays = activity.map((row) => row.day);
    const rawTotal = skills.reduce((sum, row) => sum + (row.rawScore ?? 0), 0);
    const maxTotal = skills.reduce((sum, row) => sum + (row.maxScore ?? 0), 0);

    // The latest band for a skill, preferring what a human confirmed.
    const latestBand = new Map<string, BandPoint>();
    for (const point of bands.points) {
      const current = latestBand.get(point.skill);
      if (!current || point.kind === "REVIEWED" || current.kind !== "REVIEWED") latestBand.set(point.skill, point);
    }
    const targetBand = profile?.targetBand ? Number(profile.targetBand) : null;

    return {
      days,
      timeZone,
      overview: {
        attemptsStarted: count(() => true),
        attemptsFinished: finished,
        attemptsTimedOut: timedOut,
        attemptsAbandoned: abandoned,
        mockTests: count((row) => row.mode === "MOCK" && row.status !== "ABANDONED"),
        // Of the attempts that have ended, how many the student finished themselves. Attempts still open aren't counted.
        completionRate: percent(finished, finished + timedOut + abandoned),
        rawScore: maxTotal > 0 ? rawTotal : null,
        maxScore: maxTotal > 0 ? maxTotal : null,
        accuracy: percent(rawTotal, maxTotal),
        minutes: activity.reduce((sum, row) => sum + row.minutes, 0),
        activeDays: activeDays.length,
        currentStreak: currentStreak(activeDays, today),
        longestStreak: longestStreak(activeDays),
      },
      skills,
      weekly,
      questionTypes: types,
      activity,
      bands: bands.points,
      criteria: bands.criteria,
      production,
      target: {
        targetBand,
        examDate: profile?.examDate ? isoDay(profile.examDate) : null,
        daysToExam: profile?.examDate ? Math.ceil((profile.examDate.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY) : null,
        bySkill: SKILLS.map((skill) => {
          const point = latestBand.get(skill);
          return { skill, band: point?.band ?? null, kind: point?.kind ?? null, gap: point && targetBand !== null ? roundBand(targetBand - point.band) : null };
        }),
        overall: latestBand.get("OVERALL") ? { band: latestBand.get("OVERALL")!.band, kind: latestBand.get("OVERALL")!.kind } : null,
      },
    };
  }

  return {
    overview: (actor: Actor, days: number) => cache.getOrSet("private", `analytics:${actor.userId}:${days}`, CACHE_SECONDS, () => build(actor.userId, days)),

    /** Every test the student has taken, newest first. Raw scores and bands are reported separately, and never converted. */
    async history(actor: Actor, query: { page: number; pageSize: number }) {
      const where: Prisma.ExamAttemptWhereInput = { userId: actor.userId, status: { in: ["SUBMITTED", "EXPIRED"] } };
      const [rows, total] = await prisma.$transaction([
        prisma.examAttempt.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            mode: true,
            status: true,
            startedAt: true,
            submittedAt: true,
            rawScore: true,
            maxScore: true,
            overallBand: true,
            examVersion: { select: { exam: { select: { title: true, isMock: true, examType: true } } } },
            sections: { select: { status: true, rawScore: true, maxScore: true, bandScore: true, timeSpentSeconds: true, section: { select: { skill: true, position: true } } }, orderBy: { section: { position: "asc" } } },
          },
        }),
        prisma.examAttempt.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          title: row.examVersion.exam.title,
          isMock: row.examVersion.exam.isMock,
          examType: row.examVersion.exam.examType,
          mode: row.mode,
          status: row.status,
          date: row.submittedAt ?? row.startedAt,
          rawScore: row.rawScore,
          maxScore: row.maxScore,
          accuracy: row.rawScore !== null && row.maxScore ? percent(row.rawScore, row.maxScore) : null,
          overallBand: row.overallBand === null ? null : Number(row.overallBand),
          sections: row.sections.map((section) => ({ skill: section.section.skill, status: section.status, rawScore: section.rawScore, maxScore: section.maxScore, bandScore: section.bandScore === null ? null : Number(section.bandScore), minutes: Math.round(section.timeSpentSeconds / 60) })),
        })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    invalidate: (userId: string) => cache.invalidate("private", `analytics:${userId}:`),
  };
}

export type StudentAnalyticsService = ReturnType<typeof createStudentAnalyticsService>;
export type StudentAnalytics = Awaited<ReturnType<StudentAnalyticsService["overview"]>>;
