import type { SkillName, StudentAnalytics } from "./student.service.js";

/**
 * Turns measured performance into suggestions. Every rule fires only on stored numbers and carries them as evidence,
 * so a suggestion can always be traced to what caused it. The rules decide, and AI may only explain the result.
 */
export type CatalogExam = { id: string; title: string; isMock: boolean; isPremium: boolean; skills: string[]; attempted: boolean };
export type CatalogCourse = { id: string; title: string };

export type Recommendation = {
  id: string;
  kind: "SKILL_PRACTICE" | "QUESTION_TYPE" | "VOCABULARY" | "GRAMMAR" | "WRITING_CRITERION" | "MOCK_TEST" | "CONSISTENCY" | "NEW_SKILL" | "PACING";
  priority: number;
  skill: SkillName | null;
  /** Message key, with the values to fill it. The screen builds the sentence, so the wording can't drift from the numbers. */
  evidence: Record<string, string | number>;
  action: { type: "EXAM" | "PRACTICE" | "COURSE" | "PLANNER"; href: string; label: string | null };
};

export const THRESHOLDS = {
  lowAccuracy: 60,
  minSectionsForAccuracy: 3,
  weakQuestionType: 50,
  minTypeAnswers: 8,
  vocabularySuggestions: 8,
  grammarCorrections: 8,
  minFeedbackResults: 2,
  weakCriterionGap: 0.5,
  mockFreeDays: 30,
  mockAfterSections: 5,
  examSoonDays: 56,
  inactiveDays: 14,
  minActiveDays: 3,
  timedOutShare: 30,
  minSectionsForPacing: 4,
} as const;

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** A free exam that hasn't been taken is the best match, and then anything else suitable. */
export function pickExam(catalog: CatalogExam[], test: (exam: CatalogExam) => boolean) {
  const matches = catalog.filter(test);
  const rank = (exam: CatalogExam) => (exam.attempted ? 2 : 0) + (exam.isPremium ? 1 : 0);
  return [...matches].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

export function buildRecommendations(input: {
  analytics: StudentAnalytics;
  /** Analytics covering the last 14 days and last 30 days, so "recent" means the same whatever range the page shows. */
  recentActiveDays: number;
  mocksLast30Days: number;
  catalog: CatalogExam[];
  vocabularyCourse: CatalogCourse | null;
  grammarCourse: CatalogCourse | null;
}): Recommendation[] {
  const { analytics, recentActiveDays, mocksLast30Days, catalog, vocabularyCourse, grammarCourse } = input;
  const items: Recommendation[] = [];
  const toExam = (exam: CatalogExam | null, skill: SkillName | null): Recommendation["action"] =>
    exam ? { type: "EXAM", href: `/practice/exams/${exam.id}`, label: exam.title } : { type: "PRACTICE", href: skill ? `/practice?skill=${skill}` : "/practice", label: null };

  for (const row of analytics.skills) {
    if (row.accuracy !== null && row.sectionsCompleted >= THRESHOLDS.minSectionsForAccuracy && row.accuracy < THRESHOLDS.lowAccuracy) {
      items.push({
        id: `skill-${row.skill}`,
        kind: "SKILL_PRACTICE",
        priority: 80 + (THRESHOLDS.lowAccuracy - row.accuracy) / 3,
        skill: row.skill,
        evidence: { accuracy: row.accuracy, sections: row.sectionsCompleted, threshold: THRESHOLDS.lowAccuracy },
        action: toExam(pickExam(catalog, (exam) => !exam.isMock && exam.skills.includes(row.skill)), row.skill),
      });
    }
    if (row.sectionsCompleted === 0) {
      items.push({
        id: `new-${row.skill}`,
        kind: "NEW_SKILL",
        priority: 45,
        skill: row.skill,
        evidence: { days: analytics.days },
        action: toExam(pickExam(catalog, (exam) => !exam.isMock && exam.skills.includes(row.skill)), row.skill),
      });
    }
    if (row.sectionsCompleted >= THRESHOLDS.minSectionsForPacing && pct(row.sectionsTimedOut, row.sectionsCompleted) >= THRESHOLDS.timedOutShare) {
      items.push({
        id: `pacing-${row.skill}`,
        kind: "PACING",
        priority: 55,
        skill: row.skill,
        evidence: { timedOut: row.sectionsTimedOut, sections: row.sectionsCompleted },
        action: toExam(pickExam(catalog, (exam) => !exam.isMock && exam.skills.includes(row.skill)), row.skill),
      });
    }
  }

  // The weakest kinds of question, among those with enough answers to mean something.
  for (const row of analytics.questionTypes.filter((item) => item.total >= THRESHOLDS.minTypeAnswers && item.accuracy < THRESHOLDS.weakQuestionType).slice(0, 2)) {
    items.push({
      id: `type-${row.skill}-${row.type}`,
      kind: "QUESTION_TYPE",
      priority: 70 + (THRESHOLDS.weakQuestionType - row.accuracy) / 3,
      skill: row.skill,
      evidence: { type: row.type, accuracy: row.accuracy, answers: row.total },
      action: { type: "PRACTICE", href: `/practice?skill=${row.skill}`, label: null },
    });
  }

  const focus = analytics.production.feedbackFocus;
  if (focus.results >= THRESHOLDS.minFeedbackResults && focus.vocabularySuggestions >= THRESHOLDS.vocabularySuggestions) {
    items.push({
      id: "vocabulary",
      kind: "VOCABULARY",
      priority: 65,
      skill: null,
      evidence: { suggestions: focus.vocabularySuggestions, results: focus.results },
      action: vocabularyCourse ? { type: "COURSE", href: `/courses/${vocabularyCourse.id}`, label: vocabularyCourse.title } : { type: "PRACTICE", href: "/practice/history", label: null },
    });
  }
  if (focus.results >= THRESHOLDS.minFeedbackResults && focus.grammarCorrections >= THRESHOLDS.grammarCorrections) {
    items.push({
      id: "grammar",
      kind: "GRAMMAR",
      priority: 64,
      skill: null,
      evidence: { corrections: focus.grammarCorrections, results: focus.results },
      action: grammarCourse ? { type: "COURSE", href: `/courses/${grammarCourse.id}`, label: grammarCourse.title } : { type: "PRACTICE", href: "/practice/history", label: null },
    });
  }

  // Only scores the student is allowed to see can drive this rule: human-reviewed ones, or AI bands past the release gate.
  const target = analytics.target.targetBand;
  if (target !== null) {
    const weak = analytics.criteria.filter((row) => row.skill === "WRITING" && target - row.average >= THRESHOLDS.weakCriterionGap).sort((a, b) => a.average - b.average)[0];
    if (weak) {
      items.push({
        id: `criterion-${weak.criterion}`,
        kind: "WRITING_CRITERION",
        priority: 75,
        skill: "WRITING",
        evidence: { criterion: weak.criterion, average: weak.average, target, samples: weak.samples, scoreKind: weak.kind },
        action: toExam(pickExam(catalog, (exam) => !exam.isMock && exam.skills.includes("WRITING")), "WRITING"),
      });
    }
  }

  const practiced = analytics.skills.reduce((sum, row) => sum + row.sectionsCompleted, 0);
  const daysToExam = analytics.target.daysToExam;
  const examSoon = daysToExam !== null && daysToExam >= 0 && daysToExam <= THRESHOLDS.examSoonDays;
  if (mocksLast30Days === 0 && (practiced >= THRESHOLDS.mockAfterSections || examSoon)) {
    const exam = pickExam(catalog, (entry) => entry.isMock);
    if (exam) {
      items.push({
        id: "mock",
        kind: "MOCK_TEST",
        priority: examSoon ? 90 : 60,
        skill: null,
        evidence: { mocks: 0, days: THRESHOLDS.mockFreeDays, sections: practiced, daysToExam: daysToExam ?? -1 },
        action: toExam(exam, null),
      });
    }
  }

  if (recentActiveDays < THRESHOLDS.minActiveDays) {
    items.push({
      id: "consistency",
      kind: "CONSISTENCY",
      priority: 50,
      skill: null,
      evidence: { activeDays: recentActiveDays, days: THRESHOLDS.inactiveDays },
      action: { type: "PLANNER", href: "/planner", label: null },
    });
  }

  return items.sort((a, b) => b.priority - a.priority).slice(0, 8);
}

export type SuggestedTask = { date: string; skill: SkillName | null; title: string; minutes: number; examId: string | null; reason: { kind: string; accuracy?: number | undefined } };

const DAY = 86_400_000;
const MIN_TASK_MINUTES = 15;
const DEFAULT_DAILY_MINUTES = 30;

/** Weaker skills get more time. A skill with no marked work sits in the middle, and stronger ones still get some. */
export function skillWeights(analytics: Pick<StudentAnalytics, "skills">) {
  return analytics.skills.map((row) => ({
    skill: row.skill,
    accuracy: row.accuracy,
    weight: row.accuracy !== null ? 1 + (100 - row.accuracy) / 50 : row.sectionsCompleted === 0 ? 1.5 : 1.25,
  }));
}

/**
 * A simple, explainable schedule: each day goes to whichever skill is furthest behind its share of time.
 * The same inputs always give the same plan, and nothing is guessed about the student beyond the numbers passed in.
 */
export function suggestSchedule(input: { analytics: Pick<StudentAnalytics, "skills" | "target">; dailyMinutes: number | null; weeklyHours: number | null; startDate: string; days: number; catalog: CatalogExam[] }) {
  const { analytics, startDate, catalog } = input;
  const daily = input.dailyMinutes ?? (input.weeklyHours ? Math.round((input.weeklyHours * 60) / 7) : DEFAULT_DAILY_MINUTES);
  const dailyMinutes = Math.max(MIN_TASK_MINUTES, daily);
  const perDay = dailyMinutes >= 60 ? 2 : 1;
  const taskMinutes = Math.round(dailyMinutes / perDay);
  const weights = skillWeights(analytics);
  const totalWeight = weights.reduce((sum, row) => sum + row.weight, 0);
  const given = new Map<string, number>(weights.map((row) => [row.skill, 0]));
  const used = new Set<string>();
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const daysToExam = analytics.target.daysToExam;
  const horizon = daysToExam !== null && daysToExam >= 0 ? Math.min(input.days, daysToExam) : input.days;
  const tasks: SuggestedTask[] = [];
  let assigned = 0;

  // Before an exam within reach, one mock test goes in about a week ahead of it, if there's a mock to take.
  const mock = pickExam(catalog, (exam) => exam.isMock);
  const mockDay = mock && daysToExam !== null && daysToExam > 0 && daysToExam <= input.days + 7 ? Math.max(0, daysToExam - 7) : null;

  for (let offset = 0; offset < horizon; offset += 1) {
    const date = new Date(start + offset * DAY).toISOString().slice(0, 10);
    if (mock && offset === mockDay) {
      tasks.push({ date, skill: null, title: `Mock test: ${mock.title}`, minutes: 170, examId: mock.id, reason: { kind: "MOCK" } });
      continue;
    }
    for (let slot = 0; slot < perDay; slot += 1) {
      // Furthest behind its fair share goes next, and the order of the skills breaks ties, so the result stays stable.
      const next = [...weights].sort((a, b) => (given.get(a.skill) ?? 0) / a.weight - (given.get(b.skill) ?? 0) / b.weight)[0]!;
      given.set(next.skill, (given.get(next.skill) ?? 0) + 1);
      assigned += 1;
      const exam = pickExam(catalog, (entry) => !entry.isMock && entry.skills.includes(next.skill) && !used.has(entry.id));
      if (exam) used.add(exam.id);
      tasks.push({
        date,
        skill: next.skill,
        title: exam ? `${next.skill[0]}${next.skill.slice(1).toLowerCase()} practice: ${exam.title}` : `${next.skill[0]}${next.skill.slice(1).toLowerCase()} practice`,
        minutes: taskMinutes,
        examId: exam?.id ?? null,
        reason: { kind: next.accuracy === null ? "NO_DATA" : "WEIGHTED", accuracy: next.accuracy ?? undefined },
      });
    }
  }

  return {
    dailyMinutes,
    horizonDays: horizon,
    shares: weights.map((row) => ({ skill: row.skill, accuracy: row.accuracy, percent: Math.round((row.weight / totalWeight) * 100), tasks: given.get(row.skill) ?? 0 })),
    assigned,
    tasks,
  };
}
