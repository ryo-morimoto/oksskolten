export const BASE_URL =
  process.env.OKSSKOLTEN_URL ?? "https://oksskolten.ryo-morimoto-dev.workers.dev";

export const API_KEY = process.env.OKSSKOLTEN_API_KEY ?? "";

if (!API_KEY) {
  throw new Error(
    "OKSSKOLTEN_API_KEY environment variable is required for E2E tests.\n" +
      "Usage: OKSSKOLTEN_API_KEY=ok_... npm run test:e2e",
  );
}

export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...init?.headers,
    },
  });
}
