export type EmailMessage = { to: string; subject: string; text: string };

/** delivered is true only when a real provider accepted the message. */
export type EmailResult = { delivered: boolean };

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailResult>;
}
