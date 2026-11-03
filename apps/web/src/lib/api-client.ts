import type { ApiError, ErrorCode } from "@ieltiva/shared";

export type ClientErrorCode = ErrorCode | "NETWORK_ERROR" | "UNKNOWN_ERROR";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }

  /** Field errors from the API's validation details. */
  get fieldErrors(): { path: string; message: string }[] {
    return Array.isArray(this.details) ? (this.details as { path: string; message: string }[]) : [];
  }
}

type Options = {
  baseUrl: string;
  fetcher?: typeof fetch;
};

type RequestOptions = {
  /** Skips refresh-and-retry, for calls where a 401 has its own meaning, such as a wrong password. */
  skipRefresh?: boolean;
};

const CONNECTION_MESSAGE = "We can't reach IELTiva right now. Check your connection and try again.";

/** Sessions live in HTTP-only cookies, so this client never sees or stores session tokens. */
export function createApiClient({ baseUrl, fetcher }: Options) {
  let csrfToken: string | null = null;
  let refreshing: Promise<boolean> | null = null;
  let onSessionExpired: () => void = () => {};

  async function send(method: string, path: string, body?: unknown, csrf?: string) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (csrf) headers["X-CSRF-Token"] = csrf;
    try {
      return await (fetcher ?? fetch)(`${baseUrl}${path}`, {
        method,
        headers,
        credentials: "include",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiRequestError(0, "NETWORK_ERROR", CONNECTION_MESSAGE);
    }
  }

  async function parse<T>(response: Response): Promise<T> {
    const json: unknown = await response.json().catch(() => null);
    if (response.ok) return (json as { data: T } | null)?.data as T;
    const failure = json as ApiError | null;
    throw new ApiRequestError(
      response.status,
      failure?.error?.code ?? "UNKNOWN_ERROR",
      failure?.message ?? "Something went wrong. Please try again.",
      failure?.error?.details,
    );
  }

  async function getCsrfToken(force = false) {
    if (!csrfToken || force) {
      const data = await parse<{ csrfToken: string }>(await send("GET", "/auth/csrf"));
      csrfToken = data.csrfToken;
    }
    return csrfToken;
  }

  async function sendWithCsrf(method: string, path: string, body?: unknown) {
    const response = await send(method, path, body, await getCsrfToken());
    if (response.status !== 403) return response;
    const clone = response.clone();
    const code = ((await clone.json().catch(() => null)) as ApiError | null)?.error?.code;
    return code === "CSRF_FAILED" ? send(method, path, body, await getCsrfToken(true)) : response;
  }

  /** Concurrent 401s share one refresh, because a second use of a refresh token ends the session. */
  function refreshSession() {
    refreshing ??= sendWithCsrf("POST", "/auth/refresh", {})
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const dispatch = () => (method === "GET" ? send(method, path) : sendWithCsrf(method, path, body ?? {}));
    let response = await dispatch();
    if (response.status === 401 && !options.skipRefresh) {
      if (!(await refreshSession())) {
        onSessionExpired();
        return parse<T>(response);
      }
      response = await dispatch();
      if (response.status === 401) onSessionExpired();
    }
    return parse<T>(response);
  }

  return {
    get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
    post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>("POST", path, body, options),
    setSessionExpiredHandler(handler: () => void) {
      onSessionExpired = handler;
    },
    url: (path: string) => `${baseUrl}${path}`,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1",
});
