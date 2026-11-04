import { api, ApiRequestError } from "./api-client";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

async function fetchFile(path: string) {
  return fetch(`${API_BASE}${path}`, { credentials: "include" });
}

/**
 * Saves a private file. The server checks access first and answers with either a short-lived link or the file itself.
 * The link is used straight away and never kept.
 */
export async function downloadFromApi(path: string, fallbackName: string) {
  let response = await fetchFile(path);
  if (response.status === 401) {
    // The sign-in cookie may simply have expired. This call renews it if the session is still valid.
    await api.get("/auth/me");
    response = await fetchFile(path);
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiRequestError(response.status, "UNKNOWN_ERROR", failure?.message ?? "This file isn't available.");
  }
  const anchor = document.createElement("a");
  if (response.headers.get("content-type")?.includes("application/json") && !path.includes("/privacy")) {
    const body = (await response.clone().json().catch(() => null)) as { data?: { url?: string } } | null;
    const url = body?.data?.url;
    if (url) {
      const target = new URL(url);
      if (target.protocol !== "https:") throw new ApiRequestError(0, "UNKNOWN_ERROR", "This file isn't available.");
      anchor.href = target.toString();
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  anchor.href = objectUrl;
  anchor.download = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
