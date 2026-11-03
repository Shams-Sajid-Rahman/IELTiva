import express from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "../src/middleware/error-handler.js";
import { notFoundHandler } from "../src/middleware/not-found.js";
import { AppError } from "../src/utils/app-error.js";
import { createLogger } from "../src/utils/logger.js";
import { buildApp } from "./helpers.js";

function appThatThrows(error: unknown) {
  const app = express();
  app.use(pinoHttp({ logger: createLogger("silent") }));
  app.get("/boom", async () => {
    throw error;
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("error handling", () => {
  it("returns the standard format for unknown routes", async () => {
    const res = await request(buildApp()).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it("handles malformed JSON as a client error", async () => {
    const res = await request(buildApp()).post("/api/v1/health").set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects oversized JSON and form bodies", async () => {
    const app = buildApp();
    const json = await request(app).post("/x").set("Content-Type", "application/json").send(JSON.stringify({ t: "x".repeat(1_100_000) }));
    const form = await request(app).post("/x").type("form").send(`t=${"x".repeat(1_100_000)}`);
    expect(json.status).toBe(413);
    expect(form.status).toBe(413);
    expect(json.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("passes through AppError status, code and details", async () => {
    const res = await request(appThatThrows(new AppError(409, "CONFLICT", "Already done", { id: 1 }))).get("/boom");
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ message: "Already done", error: { code: "CONFLICT", details: { id: 1 } } });
  });

  it("maps Zod errors to field details", async () => {
    const parsed = z.object({ email: z.email() }).safeParse({ email: "no" });
    const res = await request(appThatThrows(parsed.error)).get("/boom");
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("email");
  });

  it("hides unexpected messages and stack traces", async () => {
    const res = await request(appThatThrows(new Error("database password leaked"))).get("/boom");
    const text = JSON.stringify(res.body);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(text).not.toContain("password");
    expect(text).not.toContain("stack");
  });
});

describe("security defaults", () => {
  it("sets security headers and removes x-powered-by", async () => {
    const res = await request(buildApp()).get("/api/v1/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows only the configured origin", async () => {
    const app = buildApp();
    const allowed = await request(app).get("/api/v1/health").set("Origin", "http://localhost:3000");
    const denied = await request(app).get("/api/v1/health").set("Origin", "https://evil.example");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("ignores client-supplied request IDs", async () => {
    const res = await request(buildApp()).get("/api/v1/health").set("X-Request-Id", "injected");
    expect(res.headers["x-request-id"]).not.toBe("injected");
  });
});
