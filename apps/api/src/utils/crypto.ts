import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(hashToken(a));
  const right = Buffer.from(hashToken(b));
  return timingSafeEqual(left, right);
}
