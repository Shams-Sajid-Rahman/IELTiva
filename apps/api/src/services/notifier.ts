import type { NotificationType } from "../generated/prisma/enums.js";
import type { NotificationService } from "./notification.service.js";
import type { JobQueues } from "./queue/jobs.js";

type Message = { type: NotificationType; title: string; body: string; link?: string; dedupeKey?: string };

/** Which in-app messages also go by email. Payments always do, and study reminders, which the student chose to receive. */
const sendsEmail = (message: Message) => message.type === "PAYMENT" || Boolean(message.dedupeKey?.startsWith("reminder:"));

/** Sends the in-app message, then queues an email where one applies. A problem with email never fails the action that caused it. */
export function createNotifier(notifications: Pick<NotificationService, "notifyUser">, queues: JobQueues | null) {
  return async (userId: string, message: Message) => {
    await notifications.notifyUser(userId, message);
    if (queues && sendsEmail(message)) {
      await queues.add("email.notification", { userId, title: message.title, body: message.body, link: message.link ?? null }, `email-${message.dedupeKey ?? `${userId}-${Date.now()}`}`).catch(() => undefined);
    }
  };
}
