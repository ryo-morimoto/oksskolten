import { Container } from "@cloudflare/containers";

export class KuromojiContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "10m";

  override onStart() {
    // eslint-disable-next-line no-console -- TODO: replace with typed Logger (B4)
    console.log("KuromojiContainer started");
  }

  override onError(error: unknown) {
    // eslint-disable-next-line no-console -- TODO: replace with typed Logger (B4)
    console.error("KuromojiContainer error:", error);
    throw error;
  }
}

export interface TokenizeResponse {
  tokens: string;
  nouns: string[];
}

export async function tokenizeText(
  container: { fetch(req: Request): Promise<Response> },
  text: string,
): Promise<TokenizeResponse> {
  const res = await container.fetch(
    new Request("http://container/tokenize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );
  if (!res.ok) {
    throw new Error(`kuromoji tokenize failed: ${res.status}`);
  }
  return res.json();
}
