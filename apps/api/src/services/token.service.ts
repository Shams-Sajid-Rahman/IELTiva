import { jwtVerify, SignJWT } from "jose";
import type { Env } from "../config/env.js";

const ISSUER = "ieltiva-api";
const ACCESS_AUDIENCE = "ieltiva-web";
const OAUTH_AUDIENCE = "ieltiva-oauth";

export type OAuthFlowState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  linkUserId?: string;
};

export function createTokenService(env: Pick<Env, "JWT_ACCESS_SECRET" | "ACCESS_TOKEN_MINUTES">) {
  const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

  return {
    async signAccessToken(userId: string, sessionId: string) {
      const expiresAt = new Date(Date.now() + env.ACCESS_TOKEN_MINUTES * 60_000);
      const token = await new SignJWT({ sid: sessionId })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(ACCESS_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(expiresAt)
        .sign(key);
      return { token, expiresAt };
    },

    async verifyAccessToken(token: string) {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: ACCESS_AUDIENCE, algorithms: ["HS256"] });
        if (!payload.sub || typeof payload.sid !== "string") return null;
        return { userId: payload.sub, sessionId: payload.sid };
      } catch {
        return null;
      }
    },

    signOAuthFlow(flow: OAuthFlowState, minutes: number) {
      return new SignJWT({ ...flow })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(ISSUER)
        .setAudience(OAUTH_AUDIENCE)
        .setExpirationTime(`${minutes}m`)
        .sign(key);
    },

    async verifyOAuthFlow(token: string): Promise<OAuthFlowState | null> {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: OAUTH_AUDIENCE, algorithms: ["HS256"] });
        const { state, nonce, codeVerifier, linkUserId } = payload;
        if (typeof state !== "string" || typeof nonce !== "string" || typeof codeVerifier !== "string") return null;
        return { state, nonce, codeVerifier, ...(typeof linkUserId === "string" ? { linkUserId } : {}) };
      } catch {
        return null;
      }
    },
  };
}

export type TokenService = ReturnType<typeof createTokenService>;
