import { fixedOptions, type ExamSettings } from "@ieltiva/shared";
import { Prisma, type PrismaClient, type QuestionType, type Skill, type SpeakingPart, type WritingTaskType } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { pageMeta } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../audit.service.js";
import { AudioError, type AudioInfo } from "../audio/audio.service.js";
import { detectImageType, type PrivateStorage } from "../storage/private-storage.js";
import { audioContentType, detectAudioType } from "./marking.js";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const slugify = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "exam";
const json = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue));
const wordsIn = (value: string) => (value.trim() ? value.trim().split(/\s+/).length : 0);
const compact = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };

type QuestionInput = {
  number: number;
  prompt?: string | null | undefined;
  explanation?: string | null | undefined;
  marks?: number | undefined;
  scoringMode?: "ALL_OR_NOTHING" | "PER_ITEM" | undefined;
  options?: { label: string; body: string }[] | undefined;
  answers: { acceptedValue: string; caseSensitive?: boolean | undefined; ignorePunctuation?: boolean | undefined; maxWords?: number | null | undefined }[];
};

/** The full tree an author edits. This is the only place answer keys are read outside marking and review. */
const versionTree = {
  sections: {
    orderBy: { position: "asc" },
    include: {
      readingPassages: { orderBy: { position: "asc" } },
      listeningAudios: { orderBy: { position: "asc" } },
      questionGroups: { orderBy: { position: "asc" }, include: { questions: { orderBy: { number: "asc" }, include: { options: { orderBy: { position: "asc" } }, answers: true } } } },
      writingTasks: { orderBy: { position: "asc" } },
      speakingQuestions: { orderBy: [{ part: "asc" }, { position: "asc" }] },
    },
  },
} satisfies Prisma.ExamVersionInclude;

type Tree = Prisma.ExamVersionGetPayload<{ include: typeof versionTree }> & { exam: { examType: string | null; isMock: boolean } };

/** Errors block publishing. Warnings point out differences from the verified test format, which short practice papers can reasonably have. */
export function validateVersion(version: Tree) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (version.sections.length === 0) errors.push("Add at least one section.");
  if (!version.provenance) errors.push("Record where this content came from.");
  if (version.provenance === "LICENSED" && !version.sourceNote) errors.push("Licensed content needs a source note.");

  for (const section of version.sections) {
    const name = `"${section.title}"`;
    if (section.skill === "LISTENING" || section.skill === "READING") {
      const questions = section.questionGroups.flatMap((group) => group.questions.map((question) => ({ ...question, type: group.type })));
      if (questions.length === 0) errors.push(`${name} needs questions.`);
      if (section.skill === "READING" && section.readingPassages.length === 0) errors.push(`${name} needs a passage.`);
      if (section.skill === "LISTENING" && section.listeningAudios.length === 0) errors.push(`${name} needs audio.`);
      const numbers = questions.map((question) => question.number);
      if (new Set(numbers).size !== numbers.length) errors.push(`${name} repeats a question number.`);
      for (const question of questions) {
        const label = `Question ${question.number} in ${name}`;
        if (question.answers.length === 0) errors.push(`${label} has no answer key.`);
        if (question.options.length) {
          const labels = new Set(question.options.map((option) => option.label));
          if (question.answers.some((answer) => !labels.has(answer.acceptedValue))) errors.push(`${label} has an answer that isn't one of its options.`);
        } else if (question.type.startsWith("MULTIPLE_CHOICE") || question.type.startsWith("MATCHING") || question.type.endsWith("NOT_GIVEN")) {
          errors.push(`${label} needs options.`);
        }
        if (question.type === "MULTIPLE_CHOICE_SINGLE" && question.answers.length !== 1) errors.push(`${label} must have exactly one correct option.`);
        if (question.scoringMode === "PER_ITEM" && question.marks !== question.answers.length) errors.push(`${label} scores per item, so its marks must equal its number of answers.`);
      }
      if (version.exam.examType === "GENERAL_TRAINING" && section.skill === "READING" && questions.some((question) => question.type === "YES_NO_NOT_GIVEN" || question.type === "MATCHING_SENTENCE_ENDINGS")) {
        warnings.push(`${name} uses a question type that the verified format lists as not used in General Training Reading.`);
      }
    }
    if (section.skill === "WRITING") {
      if (section.writingTasks.length === 0) errors.push(`${name} needs a writing task.`);
      for (const task of section.writingTasks) {
        if (task.taskType === "ACADEMIC_TASK_1" && version.exam.examType === "GENERAL_TRAINING") errors.push(`${name} uses an Academic task in a General Training exam.`);
        if (task.taskType === "GENERAL_TASK_1" && version.exam.examType === "ACADEMIC") errors.push(`${name} uses a General Training task in an Academic exam.`);
      }
    }
    if (section.skill === "SPEAKING" && section.speakingQuestions.length === 0) errors.push(`${name} needs questions.`);
  }

  // Compares against the verified format in PROJECT_ARCHITECTURE.md, section 13.
  if (version.exam.isMock) {
    const count = (skill: Skill) => version.sections.filter((section) => section.skill === skill).flatMap((section) => section.questionGroups.flatMap((group) => group.questions)).length;
    const seconds = (skill: Skill) => version.sections.filter((section) => section.skill === skill).reduce((sum, section) => sum + section.durationSeconds, 0);
    if (count("LISTENING") !== 40) warnings.push(`The verified Listening format has 40 questions. This has ${count("LISTENING")}.`);
    if (count("READING") !== 40) warnings.push(`The verified Reading format has 40 questions. This has ${count("READING")}.`);
    if (seconds("READING") !== 3600) warnings.push("The verified Reading format allows 60 minutes.");
    if (seconds("WRITING") !== 3600) warnings.push("The verified Writing format allows 60 minutes.");
  }
  return { errors, warnings };
}

export function createExamAdminService(prisma: PrismaClient, storage: PrivateStorage, probe?: (data: Buffer) => Promise<AudioInfo>, approvalRequired?: () => Promise<boolean>) {
  const loadTree = async (versionId: string): Promise<Tree> => {
    const version = await prisma.examVersion.findUnique({ where: { id: versionId }, include: { ...versionTree, exam: { select: { examType: true, isMock: true } } } });
    if (!version) throw new AppError(404, "NOT_FOUND", "This exam version wasn't found.");
    return version;
  };

  /** Published versions never change, and the database enforces this too. Authors make a new version instead. */
  const assertDraft = async (versionId: string) => {
    const version = await prisma.examVersion.findUnique({ where: { id: versionId }, select: { publishedAt: true, status: true } });
    if (!version) throw new AppError(404, "NOT_FOUND", "This exam version wasn't found.");
    if (version.publishedAt) throw new AppError(409, "CONFLICT", "Published versions can't be changed. Create a new version.");
    // What's approved has to be what's published, so content stays fixed during review.
    if (version.status === "IN_REVIEW") throw new AppError(409, "CONFLICT", "This version is being reviewed. Withdraw it from review to make changes.");
  };

  const sectionVersion = async (sectionId: string) => {
    const section = await prisma.examSection.findUnique({ where: { id: sectionId }, select: { examVersionId: true } });
    if (!section) throw new AppError(404, "NOT_FOUND", "This section wasn't found.");
    await assertDraft(section.examVersionId);
    return section.examVersionId;
  };

  const groupSection = async (groupId: string) => {
    const group = await prisma.questionGroup.findUnique({ where: { id: groupId }, select: { sectionId: true, type: true } });
    if (!group) throw new AppError(404, "NOT_FOUND", "This question group wasn't found.");
    await sectionVersion(group.sectionId);
    return group;
  };

  const nextPosition = (rows: { position: number }[]) => (rows.length ? Math.max(...rows.map((row) => row.position)) + 1 : 1);

  const optionRows = (type: QuestionType, options?: { label: string; body: string }[]) => {
    const list = options?.length ? options : (fixedOptions[type] ?? []).map((label) => ({ label, body: label }));
    return list.map((option, index) => ({ ...option, position: index + 1 }));
  };

  const answerRows = (answers: QuestionInput["answers"]) =>
    answers.map((answer) => ({ acceptedValue: answer.acceptedValue, caseSensitive: answer.caseSensitive ?? false, ignorePunctuation: answer.ignorePunctuation ?? true, maxWords: answer.maxWords ?? null }));

  return {
    async list(query: { page: number; pageSize: number; search?: string | undefined }) {
      const where: Prisma.ExamWhereInput = { deletedAt: null, ...(query.search ? { title: { contains: query.search, mode: "insensitive" as const } } : {}) };
      const [rows, total] = await prisma.$transaction([
        prisma.exam.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { versions: { orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, status: true, publishedAt: true } } },
        }),
        prisma.exam.count({ where }),
      ]);
      return { items: rows, meta: pageMeta(query.page, query.pageSize, total) };
    },

    async create(actor: Actor, body: { title: string; slug?: string | undefined; examType?: "ACADEMIC" | "GENERAL_TRAINING" | null | undefined; isPremium?: boolean | undefined; isMock?: boolean | undefined }) {
      const slug = body.slug ?? `${slugify(body.title)}-${Date.now().toString(36)}`;
      try {
        const exam = await prisma.exam.create({
          data: { title: body.title, slug, examType: body.examType ?? null, isPremium: body.isPremium ?? false, isMock: body.isMock ?? false, versions: { create: { versionNumber: 1, createdById: actor.userId } } },
          include: { versions: true },
        });
        await recordAudit(prisma, actor, { action: "exam.create", entityType: "exam", entityId: exam.id, after: { title: exam.title } });
        return exam;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "CONFLICT", "That address is already used by another exam.");
        throw error;
      }
    },

    async get(examId: string) {
      const exam = await prisma.exam.findFirst({
        where: { id: examId, deletedAt: null },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            include: { _count: { select: { attempts: true } }, publication: { orderBy: { createdAt: "desc" }, select: { id: true, action: true, createdAt: true, actor: { select: { email: true } } } } },
          },
        },
      });
      if (!exam) throw new AppError(404, "NOT_FOUND", "This exam wasn't found.");
      return exam;
    },

    async update(actor: Actor, examId: string, body: { title?: string | undefined; slug?: string | undefined; examType?: "ACADEMIC" | "GENERAL_TRAINING" | null | undefined; isPremium?: boolean | undefined; isMock?: boolean | undefined }) {
      const exam = await prisma.exam.findFirst({ where: { id: examId, deletedAt: null } });
      if (!exam) throw new AppError(404, "NOT_FOUND", "This exam wasn't found.");
      const updated = await prisma.exam.update({ where: { id: examId }, data: compact(body) });
      await recordAudit(prisma, actor, { action: "exam.update", entityType: "exam", entityId: examId, before: { title: exam.title }, after: body });
      return updated;
    },

    async remove(actor: Actor, examId: string) {
      const exam = await prisma.exam.findFirst({ where: { id: examId, deletedAt: null } });
      if (!exam) throw new AppError(404, "NOT_FOUND", "This exam wasn't found.");
      // Hidden, not erased, so attempts that used it keep their history.
      await prisma.exam.update({ where: { id: examId }, data: { deletedAt: new Date() } });
      await recordAudit(prisma, actor, { action: "exam.delete", entityType: "exam", entityId: examId });
    },

    getVersion: loadTree,

    async updateVersion(actor: Actor, versionId: string, body: { provenance?: "ORIGINAL" | "LICENSED" | "AI_ASSISTED_REVIEWED" | undefined; sourceNote?: string | null | undefined; settings?: ExamSettings | undefined }) {
      await assertDraft(versionId);
      const { settings, ...rest } = body;
      const updated = await prisma.examVersion.update({ where: { id: versionId }, data: { ...compact(rest), ...(settings ? { settings: settings as Prisma.InputJsonValue } : {}) } });
      await recordAudit(prisma, actor, { action: "exam_version.update", entityType: "exam_version", entityId: versionId, after: body });
      return updated;
    },

    validate: async (versionId: string) => validateVersion(await loadTree(versionId)),

    async publish(actor: Actor, versionId: string) {
      const version = await loadTree(versionId);
      if (version.publishedAt) throw new AppError(409, "CONFLICT", "This version is already published.");
      const check = validateVersion(version);
      if (check.errors.length) throw new AppError(422, "VALIDATION_ERROR", "This version isn't ready to publish.", check.errors.map((message) => ({ path: "version", message })));
      const approval = await prisma.examVersion.findUniqueOrThrow({ where: { id: versionId }, select: { status: true, approvedAt: true, reviewedById: true } });
      if (approvalRequired && (await approvalRequired()) && !(approval.status === "IN_REVIEW" && approval.approvedAt && approval.reviewedById)) {
        throw new AppError(409, "CONFLICT", "This version needs a reviewer's approval before it can be published.");
      }
      const updated = await prisma.$transaction(async (tx) => {
        // Students get the newest published version. Older ones stay readable for the attempts that used them.
        const previous = await tx.examVersion.findMany({ where: { examId: version.examId, status: "PUBLISHED" }, select: { id: true } });
        for (const row of previous) {
          await tx.examVersion.update({ where: { id: row.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
          await tx.contentPublicationHistory.create({ data: { examVersionId: row.id, actorId: actor.userId, action: "ARCHIVED", fromStatus: "PUBLISHED", toStatus: "ARCHIVED" } });
        }
        const result = await tx.examVersion.update({ where: { id: versionId }, data: { status: "PUBLISHED", publishedAt: new Date(), reviewedById: approval.reviewedById ?? actor.userId } });
        await tx.contentPublicationHistory.create({ data: { examVersionId: versionId, actorId: actor.userId, action: "PUBLISHED", fromStatus: version.status, toStatus: "PUBLISHED" } });
        await recordAudit(tx, actor, { action: "exam_version.publish", entityType: "exam_version", entityId: versionId });
        return result;
      });
      return { version: updated, warnings: check.warnings };
    },

    /** The author says it's ready. It has to pass the same checks as publishing, and it can't be edited from here on. */
    async submitForReview(actor: Actor, versionId: string) {
      const version = await loadTree(versionId);
      if (version.publishedAt) throw new AppError(409, "CONFLICT", "This version is already published.");
      if (version.status === "IN_REVIEW") throw new AppError(409, "CONFLICT", "This version is already in review.");
      const check = validateVersion(version);
      if (check.errors.length) throw new AppError(422, "VALIDATION_ERROR", "This version isn't ready for review.", check.errors.map((message) => ({ path: "version", message })));
      return prisma.$transaction(async (tx) => {
        const result = await tx.examVersion.update({ where: { id: versionId }, data: { status: "IN_REVIEW", submittedAt: new Date(), approvedAt: null, reviewNote: null } });
        await tx.contentPublicationHistory.create({ data: { examVersionId: versionId, actorId: actor.userId, action: "SUBMITTED_FOR_REVIEW", fromStatus: "DRAFT", toStatus: "IN_REVIEW" } });
        await recordAudit(tx, actor, { action: "exam_version.submit_review", entityType: "exam_version", entityId: versionId });
        return result;
      });
    },

    /** A second person's decision. Only the real reviewer's own action records an approval, and an author can't approve their own version. */
    async reviewVersion(actor: Actor, versionId: string, input: { decision: "APPROVE" | "REQUEST_CHANGES"; note?: string | null | undefined }) {
      const version = await prisma.examVersion.findUnique({ where: { id: versionId }, select: { status: true, createdById: true, approvedAt: true } });
      if (!version) throw new AppError(404, "NOT_FOUND", "This exam version wasn't found.");
      if (version.status !== "IN_REVIEW") throw new AppError(409, "CONFLICT", "This version isn't waiting for review.");
      if (version.createdById === actor.userId) throw new AppError(403, "FORBIDDEN", "A second person has to review this version.");
      if (input.decision === "REQUEST_CHANGES" && !input.note) throw new AppError(400, "VALIDATION_ERROR", "Say what needs to change.");
      return prisma.$transaction(async (tx) => {
        if (input.decision === "APPROVE") {
          const result = await tx.examVersion.update({ where: { id: versionId }, data: { reviewedById: actor.userId, approvedAt: new Date(), reviewNote: input.note ?? null } });
          await tx.contentPublicationHistory.create({ data: { examVersionId: versionId, actorId: actor.userId, action: "APPROVED", fromStatus: "IN_REVIEW", toStatus: "IN_REVIEW", ...(input.note ? { note: input.note } : {}) } });
          await recordAudit(tx, actor, { action: "exam_version.approve", entityType: "exam_version", entityId: versionId });
          return result;
        }
        const result = await tx.examVersion.update({ where: { id: versionId }, data: { status: "DRAFT", approvedAt: null, reviewedById: null, reviewNote: input.note ?? null } });
        await tx.contentPublicationHistory.create({ data: { examVersionId: versionId, actorId: actor.userId, action: "RESTORED_TO_DRAFT", fromStatus: "IN_REVIEW", toStatus: "DRAFT", ...(input.note ? { note: input.note } : {}) } });
        await recordAudit(tx, actor, { action: "exam_version.request_changes", entityType: "exam_version", entityId: versionId });
        return result;
      });
    },

    /** The author takes it back to edit. Any approval ends, because the content can now change. */
    async withdrawFromReview(actor: Actor, versionId: string) {
      const version = await prisma.examVersion.findUnique({ where: { id: versionId }, select: { status: true } });
      if (!version) throw new AppError(404, "NOT_FOUND", "This exam version wasn't found.");
      if (version.status !== "IN_REVIEW") throw new AppError(409, "CONFLICT", "This version isn't in review.");
      return prisma.$transaction(async (tx) => {
        const result = await tx.examVersion.update({ where: { id: versionId }, data: { status: "DRAFT", approvedAt: null, reviewedById: null } });
        await tx.contentPublicationHistory.create({ data: { examVersionId: versionId, actorId: actor.userId, action: "RESTORED_TO_DRAFT", fromStatus: "IN_REVIEW", toStatus: "DRAFT" } });
        await recordAudit(tx, actor, { action: "exam_version.withdraw_review", entityType: "exam_version", entityId: versionId });
        return result;
      });
    },

    async archive(actor: Actor, versionId: string) {
      const version = await prisma.examVersion.findUnique({ where: { id: versionId } });
      if (!version) throw new AppError(404, "NOT_FOUND", "This exam version wasn't found.");
      if (version.status !== "PUBLISHED") throw new AppError(409, "CONFLICT", "Only a published version can be archived.");
      return prisma.$transaction(async (tx) => {
        const result = await tx.examVersion.update({ where: { id: versionId }, data: { status: "ARCHIVED", archivedAt: new Date() } });
        await tx.contentPublicationHistory.create({ data: { examVersionId: versionId, actorId: actor.userId, action: "ARCHIVED", fromStatus: "PUBLISHED", toStatus: "ARCHIVED" } });
        await recordAudit(tx, actor, { action: "exam_version.archive", entityType: "exam_version", entityId: versionId });
        return result;
      });
    },

    /** Copies the newest version into an editable draft. Files are shared, because stored files never change. */
    async createVersion(actor: Actor, examId: string) {
      const latest = await prisma.examVersion.findFirst({ where: { examId }, orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, publishedAt: true } });
      if (!latest) throw new AppError(404, "NOT_FOUND", "This exam wasn't found.");
      if (!latest.publishedAt) throw new AppError(409, "CONFLICT", "The newest version is still a draft, so edit that one.");
      const source = await loadTree(latest.id);
      return prisma.$transaction(async (tx) => {
        const version = await tx.examVersion.create({
          data: { examId, versionNumber: latest.versionNumber + 1, provenance: source.provenance, sourceNote: source.sourceNote, settings: source.settings as Prisma.InputJsonValue, createdById: actor.userId },
        });
        for (const section of source.sections) {
          await tx.examSection.create({
            data: {
              examVersionId: version.id,
              position: section.position,
              skill: section.skill,
              title: section.title,
              instructions: section.instructions,
              durationSeconds: section.durationSeconds,
              settings: section.settings as Prisma.InputJsonValue,
              readingPassages: { create: section.readingPassages.map(({ position, title, body, wordCount }) => ({ position, title, body, wordCount })) },
              listeningAudios: { create: section.listeningAudios.map(({ position, storageKey, durationSeconds, transcript }) => ({ position, storageKey, durationSeconds, transcript })) },
              writingTasks: { create: section.writingTasks.map(({ position, taskType, prompt, imageStorageKey, minWords, suggestedMinutes }) => ({ position, taskType, prompt, imageStorageKey, minWords, suggestedMinutes })) },
              speakingQuestions: { create: section.speakingQuestions.map(({ part, position, prompt, cueCard, audioStorageKey, prepSeconds, maxAnswerSeconds }) => ({ part, position, prompt, cueCard: json(cueCard), audioStorageKey, prepSeconds, maxAnswerSeconds })) },
              questionGroups: {
                create: section.questionGroups.map((group) => ({
                  position: group.position,
                  type: group.type,
                  instructions: group.instructions,
                  stimulus: json(group.stimulus),
                  imageStorageKey: group.imageStorageKey,
                  questions: {
                    create: group.questions.map((question) => ({
                      number: question.number,
                      prompt: question.prompt,
                      explanation: question.explanation,
                      marks: question.marks,
                      scoringMode: question.scoringMode,
                      options: { create: question.options.map(({ position, label, body }) => ({ position, label, body })) },
                      answers: { create: question.answers.map(({ acceptedValue, caseSensitive, ignorePunctuation, maxWords }) => ({ acceptedValue, caseSensitive, ignorePunctuation, maxWords })) },
                    })),
                  },
                })),
              },
            },
          });
        }
        await recordAudit(tx, actor, { action: "exam_version.create", entityType: "exam_version", entityId: version.id, after: { from: latest.id } });
        return version;
      });
    },

    async createSection(versionId: string, body: { skill: Skill; title: string; instructions?: string | null | undefined; durationSeconds: number; settings?: object | undefined }) {
      await assertDraft(versionId);
      const siblings = await prisma.examSection.findMany({ where: { examVersionId: versionId }, select: { position: true } });
      const { settings, ...rest } = body;
      return prisma.examSection.create({ data: { ...rest, examVersionId: versionId, position: nextPosition(siblings), settings: (settings ?? {}) as Prisma.InputJsonValue } });
    },
    async updateSection(sectionId: string, body: { skill?: Skill | undefined; title?: string | undefined; instructions?: string | null | undefined; durationSeconds?: number | undefined; settings?: object | undefined }) {
      await sectionVersion(sectionId);
      const { settings, ...rest } = body;
      return prisma.examSection.update({ where: { id: sectionId }, data: { ...compact(rest), ...(settings ? { settings: settings as Prisma.InputJsonValue } : {}) } });
    },
    async removeSection(sectionId: string) {
      await sectionVersion(sectionId);
      await prisma.examSection.delete({ where: { id: sectionId } });
    },

    async createPassage(sectionId: string, body: { title: string; body: string }) {
      await sectionVersion(sectionId);
      const siblings = await prisma.readingPassage.findMany({ where: { sectionId }, select: { position: true } });
      return prisma.readingPassage.create({ data: { ...body, sectionId, position: nextPosition(siblings), wordCount: wordsIn(body.body) } });
    },
    async updatePassage(id: string, body: { title?: string | undefined; body?: string | undefined }) {
      const row = await prisma.readingPassage.findUnique({ where: { id }, select: { sectionId: true } });
      if (!row) throw new AppError(404, "NOT_FOUND", "This passage wasn't found.");
      await sectionVersion(row.sectionId);
      return prisma.readingPassage.update({ where: { id }, data: { ...compact(body), ...(body.body ? { wordCount: wordsIn(body.body) } : {}) } });
    },
    async removePassage(id: string) {
      const row = await prisma.readingPassage.findUnique({ where: { id }, select: { sectionId: true } });
      if (!row) throw new AppError(404, "NOT_FOUND", "This passage wasn't found.");
      await sectionVersion(row.sectionId);
      await prisma.readingPassage.delete({ where: { id } });
    },

    async uploadAudio(sectionId: string, data: Buffer, givenDuration: number) {
      await sectionVersion(sectionId);
      if (data.length === 0) throw new AppError(400, "VALIDATION_ERROR", "This file is empty.");
      if (data.length > MAX_AUDIO_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "This file is too large.");
      const type = detectAudioType(data);
      if (!type) throw new AppError(400, "VALIDATION_ERROR", "This file isn't a supported audio format.");
      // Beyond its first bytes, the file has to really contain audio. The measured length replaces the typed one when it can be read.
      let durationSeconds = givenDuration;
      if (probe) {
        try {
          const info = await probe(data);
          if (info.durationSeconds > 0) durationSeconds = info.durationSeconds;
        } catch (error) {
          if (error instanceof AudioError && error.kind === "INVALID") throw new AppError(400, "VALIDATION_ERROR", "This file doesn't contain readable audio.");
        }
      }
      const siblings = await prisma.listeningAudio.findMany({ where: { sectionId }, select: { position: true } });
      const position = nextPosition(siblings);
      const storageKey = `content/${sectionId}/audio-${position}-${Date.now()}.${type.extension}`;
      await storage.put(storageKey, data);
      return prisma.listeningAudio.create({ data: { sectionId, position, storageKey, durationSeconds }, omit: { storageKey: true } });
    },
    async updateAudio(id: string, body: { transcript?: string | null | undefined; durationSeconds?: number | undefined }) {
      const row = await prisma.listeningAudio.findUnique({ where: { id }, select: { sectionId: true } });
      if (!row) throw new AppError(404, "NOT_FOUND", "This recording wasn't found.");
      await sectionVersion(row.sectionId);
      return prisma.listeningAudio.update({ where: { id }, data: compact(body), omit: { storageKey: true } });
    },
    async removeAudio(id: string) {
      const row = await prisma.listeningAudio.findUnique({ where: { id }, select: { sectionId: true } });
      if (!row) throw new AppError(404, "NOT_FOUND", "This recording wasn't found.");
      await sectionVersion(row.sectionId);
      // The file may be shared with an earlier published version, so it stays in storage.
      await prisma.listeningAudio.delete({ where: { id } });
    },
    async readAudio(id: string) {
      const row = await prisma.listeningAudio.findUnique({ where: { id }, select: { storageKey: true } });
      const data = row && (await storage.get(row.storageKey));
      if (!row || !data) throw new AppError(404, "NOT_FOUND", "This recording isn't available.");
      return { data, contentType: audioContentType(row.storageKey) };
    },

    async createGroup(sectionId: string, body: { type: QuestionType; instructions?: string | null | undefined; stimulus?: Record<string, unknown> | null | undefined }) {
      await sectionVersion(sectionId);
      const siblings = await prisma.questionGroup.findMany({ where: { sectionId }, select: { position: true } });
      return prisma.questionGroup.create({ data: { sectionId, position: nextPosition(siblings), type: body.type, instructions: body.instructions ?? null, stimulus: json(body.stimulus) } });
    },
    async updateGroup(id: string, body: { type?: QuestionType | undefined; instructions?: string | null | undefined; stimulus?: Record<string, unknown> | null | undefined }) {
      await groupSection(id);
      const { stimulus, ...rest } = body;
      return prisma.questionGroup.update({ where: { id }, data: { ...compact(rest), ...(stimulus === undefined ? {} : { stimulus: json(stimulus) }) } });
    },
    async removeGroup(id: string) {
      await groupSection(id);
      await prisma.questionGroup.delete({ where: { id } });
    },
    async uploadGroupImage(id: string, data: Buffer) {
      const group = await groupSection(id);
      if (data.length > MAX_IMAGE_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "This image is too large.");
      const type = detectImageType(data);
      if (!type) throw new AppError(400, "VALIDATION_ERROR", "Use a PNG, JPEG or WebP image.");
      const imageStorageKey = `content/${group.sectionId}/group-${id}-${Date.now()}.${type.extension}`;
      await storage.put(imageStorageKey, data);
      await prisma.questionGroup.update({ where: { id }, data: { imageStorageKey } });
      return { hasImage: true };
    },

    async createQuestion(groupId: string, body: QuestionInput) {
      const group = await groupSection(groupId);
      const clash = await prisma.question.findFirst({ where: { number: body.number, group: { sectionId: group.sectionId } }, select: { id: true } });
      if (clash) throw new AppError(409, "CONFLICT", `Question ${body.number} already exists in this section.`);
      return prisma.question.create({
        data: {
          groupId,
          number: body.number,
          prompt: body.prompt ?? null,
          explanation: body.explanation ?? null,
          marks: body.marks ?? 1,
          scoringMode: body.scoringMode ?? "ALL_OR_NOTHING",
          options: { create: optionRows(group.type, body.options) },
          answers: { create: answerRows(body.answers) },
        },
        include: { options: true, answers: true },
      });
    },
    async updateQuestion(id: string, body: Partial<QuestionInput>) {
      const question = await prisma.question.findUnique({ where: { id }, select: { groupId: true } });
      if (!question) throw new AppError(404, "NOT_FOUND", "This question wasn't found.");
      const group = await groupSection(question.groupId);
      const { options, answers, ...rest } = body;
      return prisma.$transaction(async (tx) => {
        if (options) {
          await tx.questionOption.deleteMany({ where: { questionId: id } });
          await tx.questionOption.createMany({ data: optionRows(group.type, options).map((row) => ({ ...row, questionId: id })) });
        }
        if (answers) {
          await tx.questionAnswer.deleteMany({ where: { questionId: id } });
          await tx.questionAnswer.createMany({ data: answerRows(answers).map((row) => ({ ...row, questionId: id })) });
        }
        return tx.question.update({ where: { id }, data: compact(rest), include: { options: true, answers: true } });
      });
    },
    async removeQuestion(id: string) {
      const question = await prisma.question.findUnique({ where: { id }, select: { groupId: true } });
      if (!question) throw new AppError(404, "NOT_FOUND", "This question wasn't found.");
      await groupSection(question.groupId);
      await prisma.question.delete({ where: { id } });
    },

    async createWritingTask(sectionId: string, body: { taskType: WritingTaskType; prompt: string; minWords: number; suggestedMinutes: number }) {
      await sectionVersion(sectionId);
      const siblings = await prisma.writingTask.findMany({ where: { sectionId }, select: { position: true } });
      return prisma.writingTask.create({ data: { ...body, sectionId, position: nextPosition(siblings) } });
    },
    async updateWritingTask(id: string, body: { taskType?: WritingTaskType | undefined; prompt?: string | undefined; minWords?: number | undefined; suggestedMinutes?: number | undefined }) {
      const row = await prisma.writingTask.findUnique({ where: { id }, select: { sectionId: true } });
      if (!row) throw new AppError(404, "NOT_FOUND", "This task wasn't found.");
      await sectionVersion(row.sectionId);
      return prisma.writingTask.update({ where: { id }, data: compact(body) });
    },
    async removeWritingTask(id: string) {
      const row = await prisma.writingTask.findUnique({ where: { id }, select: { sectionId: true } });
      if (!row) throw new AppError(404, "NOT_FOUND", "This task wasn't found.");
      await sectionVersion(row.sectionId);
      await prisma.writingTask.delete({ where: { id } });
    },

    async createSpeakingQuestion(sectionId: string, body: { part: SpeakingPart; prompt: string; cueCard?: string[] | null | undefined; prepSeconds?: number | null | undefined; maxAnswerSeconds: number }) {
      await sectionVersion(sectionId);
      const siblings = await prisma.speakingQuestion.findMany({ where: { sectionId, part: body.part }, select: { position: true } });
      return prisma.speakingQuestion.create({ data: { sectionId, part: body.part, position: nextPosition(siblings), prompt: body.prompt, cueCard: json(body.cueCard), prepSeconds: body.prepSeconds ?? null, maxAnswerSeconds: body.maxAnswerSeconds } });
    },
    async updateSpeakingQuestion(id: string, body: { part?: SpeakingPart | undefined; prompt?: string | undefined; cueCard?: string[] | null | undefined; prepSeconds?: number | null | undefined; maxAnswerSeconds?: number | undefined }) {
      const row = await prisma.speakingQuestion.findUnique({ where: { id }, select: { sectionId: true } });
      if (!row) throw new AppError(404, "NOT_FOUND", "This question wasn't found.");
      await sectionVersion(row.sectionId);
      const { cueCard, ...rest } = body;
      return prisma.speakingQuestion.update({ where: { id }, data: { ...compact(rest), ...(cueCard === undefined ? {} : { cueCard: json(cueCard) }) } });
    },
    async removeSpeakingQuestion(id: string) {
      const row = await prisma.speakingQuestion.findUnique({ where: { id }, select: { sectionId: true } });
      if (!row) throw new AppError(404, "NOT_FOUND", "This question wasn't found.");
      await sectionVersion(row.sectionId);
      await prisma.speakingQuestion.delete({ where: { id } });
    },
  };
}

export type ExamAdminService = ReturnType<typeof createExamAdminService>;
