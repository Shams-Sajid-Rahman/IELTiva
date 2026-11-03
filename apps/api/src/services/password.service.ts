import argon2 from "argon2";

// OWASP's recommended Argon2id minimum configuration.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

// Unknown accounts verify against this, so response time doesn't reveal whether an email exists.
const dummyHash = argon2.hash("ieltiva-timing-placeholder", OPTIONS);

export function hashPassword(password: string) {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string | null | undefined, password: string) {
  const matches = await argon2.verify(hash ?? (await dummyHash), password);
  return Boolean(hash) && matches;
}
