import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Env } from "../config/env.js";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type GoogleIdentity = {
  subject: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
};

export type GoogleFlow = { state: string; nonce: string; codeVerifier: string };

export interface OAuthProvider {
  buildAuthorizationUrl(flow: GoogleFlow): string;
  exchangeCode(code: string, flow: GoogleFlow): Promise<GoogleIdentity>;
}

export async function verifyGoogleIdToken(
  idToken: string,
  { keys, clientId, nonce }: { keys: JWTVerifyGetKey; clientId: string; nonce: string },
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, keys, { issuer: ISSUERS, audience: clientId, algorithms: ["RS256"] });
  if (payload.nonce !== nonce) throw new Error("Google ID token nonce mismatch");
  if (!payload.sub || typeof payload.email !== "string") throw new Error("Google ID token is missing identity claims");
  return {
    subject: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    firstName: typeof payload.given_name === "string" ? payload.given_name : "IELTiva",
    lastName: typeof payload.family_name === "string" ? payload.family_name : "Student",
  };
}

export class GoogleOAuthProvider implements OAuthProvider {
  private readonly redirectUri: string;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    apiBaseUrl: string,
    private readonly keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(JWKS_URL)),
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.redirectUri = `${apiBaseUrl}/api/v1/auth/google/callback`;
  }

  buildAuthorizationUrl({ state, nonce, codeVerifier }: GoogleFlow) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return `${AUTHORIZE_URL}?${params}`;
  }

  async exchangeCode(code: string, flow: GoogleFlow) {
    const response = await this.fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        code_verifier: flow.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri,
      }),
    });
    if (!response.ok) throw new Error(`Google token exchange responded with ${response.status}`);
    const { id_token: idToken } = (await response.json()) as { id_token?: unknown };
    if (typeof idToken !== "string") throw new Error("Google token response has no ID token");
    return verifyGoogleIdToken(idToken, { keys: this.keys, clientId: this.clientId, nonce: flow.nonce });
  }
}

export function createGoogleProvider(env: Pick<Env, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "API_BASE_URL">): OAuthProvider | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return new GoogleOAuthProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.API_BASE_URL);
}
