import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { getHealth } from "../src/services/health.service.js";
import { buildApp } from "./helpers.js";

describe("GET /api/v1/health", () => {
  it("returns 200 and the agreed structure when the database responds", async () => {
    const res = await request(buildApp()).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: "IELTiva API is running",
      data: { application: "IELTiva API", apiVersion: "v1", environment: "test", status: "healthy", database: "connected" },
    });
    expect(Number.isNaN(Date.parse(res.body.data.timestamp))).toBe(false);
  });

  it("returns 503 without internal details when the database is down", async () => {
    const app = buildApp(async () => {
      throw new Error("connection to secret-host failed");
    });
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, data: { status: "unhealthy", database: "disconnected" } });
    expect(JSON.stringify(res.body)).not.toContain("secret-host");
  });

  it("treats a hanging database as disconnected", async () => {
    const data = await getHealth(() => new Promise(() => {}), "test", 10);
    expect(data.database).toBe("disconnected");
  });

  it("doesn't require authentication and calls the check once", async () => {
    const check = vi.fn(async () => {});
    await request(buildApp(check)).get("/api/v1/health").expect(200);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
