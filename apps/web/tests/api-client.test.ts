import { describe, expect, it, vi } from "vitest";
import { ApiRequestError, createApiClient } from "@/lib/api-client";
import { apiError, json, mockFetch } from "./auth-mocks";

const client = (fetcher: typeof fetch) => createApiClient({ baseUrl: "http://api.test/api/v1", fetcher });

describe("api client", () => {
  it("sends credentials and a CSRF token, and unwraps data", async () => {
    const { fetcher, calls } = mockFetch(() => json(200, { ok: true }));
    await expect(client(fetcher).post("/thing", { a: 1 })).resolves.toEqual({ ok: true });
    const call = calls.find((c) => c.path === "/thing")!;
    expect(call.headers["X-CSRF-Token"]).toBe("csrf1");
    expect(call.body).toEqual({ a: 1 });
  });

  it("turns API errors into typed errors with field details", async () => {
    const { fetcher } = mockFetch(() => apiError(400, "VALIDATION_ERROR", "Bad", [{ path: "email", message: "Invalid" }]));
    const error = await client(fetcher).post("/thing", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 400, code: "VALIDATION_ERROR", message: "Bad" });
    expect((error as ApiRequestError).fieldErrors[0]!.path).toBe("email");
  });

  it("reports network failures clearly", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("failed");
    }) as unknown as typeof fetch;
    await expect(client(fetcher).get("/thing")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });

  it("handles a non-JSON error response", async () => {
    const fetcher = vi.fn(async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch;
    await expect(client(fetcher).get("/thing")).rejects.toMatchObject({ status: 502, code: "UNKNOWN_ERROR" });
  });

  it("refreshes once on 401 and retries", async () => {
    let refreshed = false;
    const { fetcher, calls } = mockFetch((path) => {
      if (path === "/auth/refresh") {
        refreshed = true;
        return json(200, null);
      }
      return refreshed ? json(200, "fresh") : apiError(401, "UNAUTHENTICATED", "No");
    });
    await expect(client(fetcher).get("/thing")).resolves.toBe("fresh");
    expect(calls.filter((c) => c.path === "/auth/refresh")).toHaveLength(1);
  });

  it("shares one refresh across simultaneous requests", async () => {
    let refreshed = false;
    const { fetcher, calls } = mockFetch((path) => {
      if (path === "/auth/refresh") {
        refreshed = true;
        return json(200, null);
      }
      return refreshed ? json(200, path) : apiError(401, "UNAUTHENTICATED", "No");
    });
    const api = client(fetcher);
    const results = await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);
    expect(results.sort()).toEqual(["/a", "/b", "/c"]);
    expect(calls.filter((c) => c.path === "/auth/refresh")).toHaveLength(1);
  });

  it("uses a browser lock so other tabs can't refresh at the same time", async () => {
    const request = vi.fn((_name: string, work: () => Promise<Response>) => work());
    vi.stubGlobal("navigator", { locks: { request } });
    let refreshed = false;
    const { fetcher } = mockFetch((path) => {
      if (path === "/auth/refresh") {
        refreshed = true;
        return json(200, null);
      }
      return refreshed ? json(200, "ok") : apiError(401, "UNAUTHENTICATED", "No");
    });
    await expect(client(fetcher).get("/thing")).resolves.toBe("ok");
    vi.unstubAllGlobals();
    expect(request).toHaveBeenCalledWith("ieltiva-session-refresh", expect.any(Function));
  });

  it("reports an expired session when refresh fails", async () => {
    const { fetcher } = mockFetch(() => apiError(401, "UNAUTHENTICATED", "Ended"));
    const api = client(fetcher);
    const expired = vi.fn();
    api.setSessionExpiredHandler(expired);
    await expect(api.get("/thing")).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
  });

  it("doesn't refresh when told a 401 has its own meaning", async () => {
    const { fetcher, calls } = mockFetch(() => apiError(401, "UNAUTHENTICATED", "Incorrect email or password."));
    await expect(client(fetcher).post("/auth/login", {}, { skipRefresh: true })).rejects.toThrow("Incorrect");
    expect(calls.some((c) => c.path === "/auth/refresh")).toBe(false);
  });

  it("fetches a new CSRF token and retries once after CSRF_FAILED", async () => {
    let attempts = 0;
    const { fetcher, calls } = mockFetch(() => (++attempts === 1 ? apiError(403, "CSRF_FAILED", "No") : json(200, "ok")));
    await expect(client(fetcher).post("/thing")).resolves.toBe("ok");
    expect(calls.filter((c) => c.path === "/auth/csrf")).toHaveLength(2);
  });
});
