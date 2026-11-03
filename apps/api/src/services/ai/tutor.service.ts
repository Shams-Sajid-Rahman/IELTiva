import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { pageMeta } from "../../utils/api-response.js";
import { AppError } from "../../utils/app-error.js";
import type { AiService } from "./ai.service.js";
import { escapeForPrompt } from "./prompts.js";
import { AiError, type ChatMessage } from "./provider.js";
import { redactPersonalDetails } from "./redact.js";

/** History is append-only because assistant turns are bound to their conversation, so a long one ends rather than being trimmed. */
const MAX_MESSAGES = 60;
const DAILY_MESSAGE_LIMIT = 100;

export function createTutorService(prisma: PrismaClient, ai: AiService) {
  const own = async (actor: Actor, id: string) => {
    const row = await prisma.tutorConversation.findFirst({ where: { id, userId: actor.userId } });
    if (!row) throw new AppError(404, "NOT_FOUND", "This conversation wasn't found.");
    return row;
  };

  async function assertAllowed(actor: Actor) {
    if (!ai.isConfigured()) throw new AppError(503, "SERVICE_UNAVAILABLE", "The AI tutor isn't available yet.");
    const consent = await prisma.userConsent.findFirst({ where: { userId: actor.userId, type: "AI_PROCESSING", revokedAt: null } });
    if (!consent) throw new AppError(403, "FORBIDDEN", "Please give your consent first.", [{ path: "consent", message: "AI_PROCESSING" }]);
    const since = new Date(Date.now() - 86_400_000);
    const used = await prisma.tutorMessage.count({ where: { role: "user", createdAt: { gte: since }, conversation: { userId: actor.userId } } });
    if (used >= DAILY_MESSAGE_LIMIT) throw new AppError(429, "RATE_LIMITED", "You've reached today's tutor limit. Please try again tomorrow.");
  }

  /** Adds a question from a finished attempt. It refuses open attempts, so the tutor can't supply answers during an exam. */
  async function reviewContext(actor: Actor, attemptId: string, questionId: string) {
    const attempt = await prisma.examAttempt.findFirst({ where: { id: attemptId, userId: actor.userId }, select: { status: true } });
    if (!attempt) throw new AppError(404, "NOT_FOUND", "This attempt wasn't found.");
    if (attempt.status !== "SUBMITTED" && attempt.status !== "EXPIRED") throw new AppError(409, "CONFLICT", "The tutor can explain answers after you finish the attempt.");
    const question = await prisma.question.findFirst({
      where: { id: questionId, responses: { some: { sectionAttempt: { examAttemptId: attemptId } } } },
      include: { answers: true, responses: { where: { sectionAttempt: { examAttemptId: attemptId } } } },
    });
    if (!question) throw new AppError(404, "NOT_FOUND", "This question wasn't found.");
    return `<exam_review>
Question: ${escapeForPrompt(question.prompt ?? "")}
Student's answer: ${escapeForPrompt(JSON.stringify(question.responses[0]?.response ?? null))}
Accepted answers: ${escapeForPrompt(question.answers.map((answer) => answer.acceptedValue).join(" / "))}
</exam_review>

`;
  }

  return {
    async list(actor: Actor, query: { page: number; pageSize: number }) {
      const where = { userId: actor.userId };
      const [items, total] = await prisma.$transaction([
        prisma.tutorConversation.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, title: true, updatedAt: true } }),
        prisma.tutorConversation.count({ where }),
      ]);
      return { items, meta: pageMeta(query.page, query.pageSize, total) };
    },

    async get(actor: Actor, id: string) {
      await own(actor, id);
      return prisma.tutorConversation.findUniqueOrThrow({
        where: { id },
        select: { id: true, title: true, messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, text: true, createdAt: true } } },
      });
    },

    async create(actor: Actor) {
      await assertAllowed(actor);
      return prisma.tutorConversation.create({ data: { userId: actor.userId }, select: { id: true, title: true, updatedAt: true } });
    },

    async remove(actor: Actor, id: string) {
      await own(actor, id);
      await prisma.tutorConversation.delete({ where: { id } });
    },

    /** Streams the reply as it's written. The student's message is saved first, and the reply only if it finishes. */
    async send(actor: Actor, id: string, body: { message: string; attemptId?: string | undefined; questionId?: string | undefined }, stream: { onText: (text: string) => void; signal: AbortSignal }) {
      const conversation = await own(actor, id);
      await assertAllowed(actor);
      const history = await prisma.tutorMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } });
      if (history.length + 2 > MAX_MESSAGES) throw new AppError(409, "CONFLICT", "This conversation is full. Please start a new one.");
      const context = body.attemptId && body.questionId ? await reviewContext(actor, body.attemptId, body.questionId) : "";
      const safeMessage = redactPersonalDetails(body.message);
      const userText = `${context}${safeMessage}`;
      await prisma.tutorMessage.create({ data: { conversationId: id, role: "user", text: body.message, content: userText } });

      const messages: ChatMessage[] = [
        ...history.map((row) => ({ role: row.role as "user" | "assistant", text: row.text, content: row.content ?? row.text })),
        { role: "user", text: userText },
      ];
      let result;
      try {
        result = await ai.chat("tutor.chat", messages, { userId: actor.userId, signal: stream.signal, onText: stream.onText });
      } catch (error) {
        // An unanswered turn would break the next request, so it's removed along with the failed reply.
        await prisma.tutorMessage.deleteMany({ where: { conversationId: id, role: "user", text: body.message, createdAt: { gte: new Date(Date.now() - 600_000) } } });
        throw error;
      }
      const saved = await prisma.tutorMessage.create({ data: { conversationId: id, role: "assistant", text: result.text, content: result.content as Prisma.InputJsonValue } });
      await prisma.tutorConversation.update({ where: { id }, data: { updatedAt: new Date() } });
      if (!conversation.title) {
        // A missing title is harmless, so this never fails the reply.
        try {
          const title = await ai.chat("tutor.title", [{ role: "user", text: `<student_message>${escapeForPrompt(safeMessage.slice(0, 500))}</student_message>` }], { userId: actor.userId, onText: () => {} });
          await prisma.tutorConversation.update({ where: { id }, data: { title: title.text.trim().slice(0, 80) || body.message.slice(0, 60) } });
        } catch {
          await prisma.tutorConversation.update({ where: { id }, data: { title: body.message.slice(0, 60) } });
        }
      }
      return { id: saved.id };
    },

    /** Short, one-off explanations on the light tier. */
    async explain(actor: Actor, body: { kind: "grammar" | "vocabulary" | "sentence"; text: string }) {
      await assertAllowed(actor);
      try {
        const result = await ai.chat("explain.light", [{ role: "user", text: `Explain the ${body.kind} here.\n<student_text>${escapeForPrompt(redactPersonalDetails(body.text))}</student_text>` }], { userId: actor.userId, onText: () => {} });
        return { text: result.text };
      } catch (error) {
        throw toAppError(error);
      }
    },
  };
}

export function toAppError(error: unknown) {
  if (error instanceof AppError) return error;
  if (error instanceof AiError) {
    if (error.code === "REFUSED") return new AppError(422, "VALIDATION_ERROR", "The tutor can't help with that request.");
    if (error.code === "RATE_LIMITED") return new AppError(429, "RATE_LIMITED", "The AI service is busy. Please try again shortly.");
    if (error.code === "NOT_CONFIGURED") return new AppError(503, "SERVICE_UNAVAILABLE", "The AI tutor isn't available yet.");
  }
  return new AppError(503, "SERVICE_UNAVAILABLE", "The AI tutor had a problem. Please try again.");
}

export type TutorService = ReturnType<typeof createTutorService>;
