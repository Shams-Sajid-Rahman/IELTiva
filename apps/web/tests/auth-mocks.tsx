import { expect, vi } from "vitest";

export const router = { replace: vi.fn(), push: vi.fn() };
export const navigation = { pathname: "/dashboard", params: new URLSearchParams() };

export function setSearch(search: string) {
  navigation.params = new URLSearchParams(search);
}

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.params,
}));

export type Route = { status: number; body?: unknown };
export type Handler = (url: string, init: RequestInit) => Route | undefined;

export function json(status: number, data: unknown) {
  return { status, body: status < 400 ? { success: true, message: "ok", data } : data };
}

export function apiError(status: number, code: string, message: string, details?: unknown) {
  return { status, body: { success: false, message, error: { code, details, requestId: "r" } } };
}

export const student = {
  id: "u1",
  email: "student@example.com",
  firstName: "Ayesha",
  lastName: "Rahman",
  emailVerified: false,
  roles: ["STUDENT"],
  permissions: ["attempts.own"],
};

export function mockFetch(handler: Handler) {
  const calls: { method: string; path: string; body?: unknown; headers: Record<string, string> }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const path = url.replace(/^.*\/api\/v1/, "");
    calls.push({
      method: init.method ?? "GET",
      path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
    });
    expect(init.credentials).toBe("include");
    if (path === "/auth/csrf") return new Response(JSON.stringify({ data: { csrfToken: "csrf1" } }), { status: 200 });
    const route = handler(path, init) ?? apiError(404, "NOT_FOUND", "Not found");
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), { status: route.status });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}
