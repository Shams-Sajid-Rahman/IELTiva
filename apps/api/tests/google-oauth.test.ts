import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { GoogleOAuthProvider, verifyGoogleIdToken } from "../src/services/google-oauth.service.js";
import { ResendEmailProvider } from "../src/services/email/index.js";

const clientId = "client.apps.example";
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

let privateKey: SigningKey;
let otherKey: SigningKey;
let keys: ReturnType<typeof createLocalJWKSet>;

async function idToken(claims: Record<string, unknown> = {}, options: { issuer?: string; audience?: string; key?: SigningKey; expires?: string } = {}) {
  return new SignJWT({ nonce: "n1", email: "User@Example.com", email_verified: true, given_name: "A", family_name: "B", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setSubject("google-sub")
    .setIssuer(options.issuer ?? "https://accounts.google.com")
    .setAudience(options.audience ?? clientId)
    .setIssuedAt()
    .setExpirationTime(options.expires ?? "5m")
    .sign(options.key ?? privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
});

const verify = (token: string, nonce = "n1") => verifyGoogleIdToken(token, { keys, clientId, nonce });

describe("Google ID token validation", () => {
  it("accepts a valid token and normalises the email", async () => {
    await expect(verify(await idToken())).resolves.toMatchObject({ subject: "google-sub", email: "user@example.com", emailVerified: true });
  });

  it("rejects the wrong audience, issuer, signature, nonce and expired tokens", async () => {
    await expect(verify(await idToken({}, { audience: "other" }))).rejects.toThrow();
    await expect(verify(await idToken({}, { issuer: "https://evil.example" }))).rejects.toThrow();
    await expect(verify(await idToken({}, { key: otherKey }))).rejects.toThrow();
    await expect(verify(await idToken(), "different")).rejects.toThrow(/nonce/);
    await expect(verify(await idToken({}, { expires: "-1m" }))).rejects.toThrow();
  });

  it("reports an unverified Google email as unverified", async () => {
    await expect(verify(await idToken({ email_verified: false }))).resolves.toMatchObject({ emailVerified: false });
  });
});

describe("GoogleOAuthProvider", () => {
  const flow = { state: "s1", nonce: "n1", codeVerifier: "v1" };

  it("builds an authorization URL with state, nonce and PKCE", () => {
    const provider = new GoogleOAuthProvider(clientId, "secret", "https://api.example", keys);
    const url = new URL(provider.buildAuthorizationUrl(flow));
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("nonce")).toBe("n1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).not.toBe("v1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.example/api/v1/auth/google/callback");
    expect(url.toString()).not.toContain("secret");
  });

  it("exchanges a code and validates the returned token", async () => {
    const token = await idToken();
    const fetcher = (async () => new Response(JSON.stringify({ id_token: token }))) as typeof fetch;
    const provider = new GoogleOAuthProvider(clientId, "secret", "https://api.example", keys, fetcher);
    await expect(provider.exchangeCode("code", flow)).resolves.toMatchObject({ subject: "google-sub" });
  });

  it("fails on a Google error or a missing token", async () => {
    const failing = new GoogleOAuthProvider(clientId, "s", "https://a.example", keys, (async () => new Response("", { status: 400 })) as typeof fetch);
    const empty = new GoogleOAuthProvider(clientId, "s", "https://a.example", keys, (async () => new Response("{}")) as typeof fetch);
    await expect(failing.exchangeCode("c", flow)).rejects.toThrow(/400/);
    await expect(empty.exchangeCode("c", flow)).rejects.toThrow(/ID token/);
  });
});

describe("ResendEmailProvider", () => {
  it("reports delivery only when the provider accepts the message", async () => {
    const ok = new ResendEmailProvider("key", "a@example.com", (async () => new Response("{}")) as typeof fetch);
    const bad = new ResendEmailProvider("key", "a@example.com", (async () => new Response("", { status: 500 })) as typeof fetch);
    const message = { to: "b@example.com", subject: "s", text: "t" };
    await expect(ok.send(message)).resolves.toEqual({ delivered: true });
    await expect(bad.send(message)).rejects.toThrow(/500/);
  });
});
