import { authHeaders, handleResponseError } from "./api-base";

export { authHeaders };

const DEFAULT_TIMEOUT = 30_000;

/** SWR-compatible fetcher for GET requests. */
export async function fetcher<T = unknown>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const res = await fetch(url, {
      headers: { ...authHeaders(), Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return handleResponseError(res, url);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiPost<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", Accept: "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) return handleResponseError(res, url);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function apiPatch<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return handleResponseError(res, url);
  return res.json() as Promise<T>;
}

export async function apiDelete(url: string): Promise<void> {
  const res = await fetch(url, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) return handleResponseError(res, url);
}
