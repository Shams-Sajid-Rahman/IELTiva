import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

const valid = {
  NODE_ENV: "development",
  FRONTEND_URL: "http://localhost:3000",
  API_BASE_URL: "http://localhost:5000",
  DATABASE_URL: "postgresql://u:secret-value@localhost:5433/db",
  JWT_ACCESS_SECRET: "a".repeat(40),
  CSRF_SECRET: "b".repeat(40),
};

describe("parseEnv", () => {
  it("applies defaults and converts numbers", () => {
    const env = parseEnv({ ...valid, PORT: "5050" });
    expect(env.PORT).toBe(5050);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.ACCESS_TOKEN_MINUTES).toBe(15);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it("names every invalid variable", () => {
    expect(() => parseEnv({ PORT: "99999" })).toThrow(/NODE_ENV[\s\S]*PORT[\s\S]*DATABASE_URL[\s\S]*FRONTEND_URL[\s\S]*API_BASE_URL[\s\S]*JWT_ACCESS_SECRET[\s\S]*CSRF_SECRET/);
  });

  it("accepts only PostgreSQL and doesn't print the value", () => {
    for (const url of ["mysql://u:secret-value@host/db", "file:secret-value.db", "mongodb://secret-value"]) {
      const attempt = () => parseEnv({ ...valid, DATABASE_URL: url });
      expect(attempt).toThrow(/DATABASE_URL/);
      expect(attempt).not.toThrow(/secret-value/);
    }
  });

  it("requires https and secure cookies in production", () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: "production" })).toThrow(/FRONTEND_URL[\s\S]*API_BASE_URL[\s\S]*COOKIE_SECURE/);
    const env = parseEnv({ ...valid, NODE_ENV: "production", FRONTEND_URL: "https://a.example", API_BASE_URL: "https://b.example", COOKIE_SECURE: "true" });
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it("rejects placeholder, short and shared secrets", () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: "CHANGE_ME".repeat(5) })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ ...valid, CSRF_SECRET: "short" })).toThrow(/CSRF_SECRET/);
    expect(() => parseEnv({ ...valid, CSRF_SECRET: valid.JWT_ACCESS_SECRET })).toThrow(/CSRF_SECRET/);
  });

  it("treats empty optional values as unset, and requires Google values as a pair", () => {
    const env = parseEnv({ ...valid, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", COOKIE_DOMAIN: "" });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(() => parseEnv({ ...valid, GOOGLE_CLIENT_ID: "id" })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });
});
