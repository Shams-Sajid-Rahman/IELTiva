import type { Env } from "../../config/env.js";
import type { Logger } from "../../utils/logger.js";
import type { EmailMessage, EmailProvider } from "./email.provider.js";

type FetchLike = typeof fetch;

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async send({ to, subject, text }: EmailMessage) {
    const response = await this.fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to, subject, text }),
    });
    if (!response.ok) throw new Error(`Email provider responded with ${response.status}`);
    return { delivered: true };
  }
}

/** Development only. Prints the message, which includes its link, and reports that nothing was delivered. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  constructor(private readonly logger: Pick<Logger, "warn">) {}

  async send({ subject, text }: EmailMessage) {
    this.logger.warn({ subject, text }, "Development email NOT delivered");
    return { delivered: false };
  }
}

export class UnavailableEmailProvider implements EmailProvider {
  readonly name = "unavailable";

  constructor(private readonly logger: Pick<Logger, "error">) {}

  async send({ subject }: EmailMessage) {
    this.logger.error({ subject }, "Email not sent because no email provider is configured");
    return { delivered: false };
  }
}

export function createEmailProvider(env: Pick<Env, "NODE_ENV" | "RESEND_API_KEY" | "EMAIL_FROM">, logger: Logger): EmailProvider {
  if (env.RESEND_API_KEY && env.EMAIL_FROM) return new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
  return env.NODE_ENV === "development" ? new ConsoleEmailProvider(logger) : new UnavailableEmailProvider(logger);
}
