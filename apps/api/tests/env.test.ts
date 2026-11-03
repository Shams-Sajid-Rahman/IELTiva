import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

const valid = {
  FRONTEND_URL: "http://localhost:3000",
  API_BASE_URL: "http://localhost:5000",
  DATABASE_URL: "postgresql://u:secret-value@localhost:5433/db",
};

describe("parseEnv", () => {
  it("applies defaults and converts numbers", () => {
    const env = parseEnv({ ...valid, PORT: "5050" });
    expect(env.PORT).toBe(5050);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("names every invalid variable", () => {
    expect(() => parseEnv({ PORT: "99999" })).toThrow(/PORT[\s\S]*DATABASE_URL[\s\S]*FRONTEND_URL[\s\S]*API_BASE_URL/);
  });

  it("accepts only PostgreSQL and doesn't print the value", () => {
    for (const url of ["mysql://u:secret-value@host/db", "file:secret-value.db", "mongodb://secret-value"]) {
      const attempt = () => parseEnv({ ...valid, DATABASE_URL: url });
      expect(attempt).toThrow(/DATABASE_URL/);
      expect(attempt).not.toThrow(/secret-value/);
    }
  });

  it("requires https in production", () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: "production" })).toThrow(/FRONTEND_URL[\s\S]*API_BASE_URL/);
    const env = parseEnv({ ...valid, NODE_ENV: "production", FRONTEND_URL: "https://a.example", API_BASE_URL: "https://b.example" });
    expect(env.NODE_ENV).toBe("production");
  });
});
