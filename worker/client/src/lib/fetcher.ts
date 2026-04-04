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

// OPML import/export types

export interface OpmlPreviewFeed {
  name: string
  url: string
  rssUrl: string
  categoryName: string | null
  isDuplicate: boolean
}

export interface OpmlPreviewResponse {
  feeds: OpmlPreviewFeed[]
  totalCount: number
  duplicateCount: number
}

export async function previewOpml(file: File): Promise<OpmlPreviewResponse> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/opml/preview', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  })
  if (!res.ok) return handleResponseError(res, '/api/opml/preview')
  return res.json()
}

export async function importOpml(
  file: File,
  selectedUrls?: string[],
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const formData = new FormData()
  formData.append('file', file)
  if (selectedUrls) {
    formData.append('selectedUrls', JSON.stringify(selectedUrls))
  }
  const res = await fetch('/api/opml', {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  })
  if (!res.ok) return handleResponseError(res, '/api/opml')
  return res.json()
}

export async function fetchOpmlBlob(): Promise<Blob> {
  const res = await fetch('/api/opml', {
    headers: authHeaders(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  })
  if (!res.ok) return handleResponseError(res, '/api/opml')
  return res.blob()
}
