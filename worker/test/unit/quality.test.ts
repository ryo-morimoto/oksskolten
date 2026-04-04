import { describe, it, expect } from "vitest";
import { computeQualityScore } from "../../server/lib/quality";

describe("computeQualityScore", () => {
  it("returns 0 for empty/very short content", () => {
    expect(computeQualityScore({ markdown: "" })).toBe(0);
    expect(computeQualityScore({ markdown: "short" })).toBe(0);
  });

  it("scores high for a well-structured technical article", () => {
    const markdown = `# Deep Dive into Cloudflare Workers

## Introduction

This is a comprehensive guide to building production applications on Cloudflare Workers. We'll cover architecture patterns, performance optimization, and real-world deployment strategies that have proven effective at scale.

Workers run on V8 isolates across Cloudflare's global network, providing sub-millisecond cold starts and automatic scaling. See the [official documentation](https://developers.cloudflare.com/workers/) for the latest API reference.

## Architecture Patterns

### Request Routing

The most common pattern is using Hono as a lightweight router. Here's a complete example with middleware:

\`\`\`typescript
import { Hono } from 'hono'

const app = new Hono()
app.get('/api/health', (c) => c.json({ ok: true }))
export default app
\`\`\`

### Data Layer

D1 provides SQLite at the edge. For complex queries, consider using [prepared statements](https://developers.cloudflare.com/d1/build-with-d1/d1-client-api/) for type safety and performance.

\`\`\`typescript
const result = await env.DB.prepare('SELECT * FROM articles WHERE id = ?')
  .bind(id)
  .first()
\`\`\`

## Performance Optimization

### Bundle Size

Keep your Worker bundle under 1MB compressed. Use dynamic imports for heavy dependencies like [Defuddle](https://github.com/nicholasgma/defuddle) that are only needed in specific code paths.

![Architecture diagram](https://example.com/arch.png)

### Caching Strategy

The [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) provides fine-grained control over response caching at the edge.

## Conclusion

Workers provide a compelling platform for building globally distributed applications with minimal operational overhead.`;

    const score = computeQualityScore({ markdown });
    expect(score).toBeGreaterThan(0.4);
  });

  it("scores low for a short stub article", () => {
    const markdown = `# Quick Update

New version released. Check it out.`;

    const score = computeQualityScore({ markdown });
    expect(score).toBeLessThan(0.3);
  });

  it("uses tokenCount for Japanese word count when provided", () => {
    // Japanese text is short in chars but long in tokens — tokenCount overrides word counting
    const markdown = `# Cloudflare Workers の深掘り

## はじめに

この記事では、Cloudflare Workers を使った本番アプリケーション構築について詳しく解説します。アーキテクチャパターン、パフォーマンス最適化、実際のデプロイ戦略を取り上げます。

## アーキテクチャ

### リクエストルーティング

Hono を使った軽量ルーターが最も一般的なパターンです。ミドルウェアを含む完全な例を示します。

### データレイヤー

D1 はエッジで SQLite を提供します。複雑なクエリには、型安全性とパフォーマンスのためにプリペアドステートメントの使用を検討してください。`;

    const scoreWithoutTokens = computeQualityScore({ markdown });
    const scoreWithTokens = computeQualityScore({ markdown, tokenCount: 3000 });
    expect(scoreWithTokens).toBeGreaterThan(scoreWithoutTokens);
  });

  it("rewards heading depth (h2+h3+h4)", () => {
    const flat = `# Title\n\n## Section 1\n\nContent here with enough words to pass the minimum threshold for word count normalization.\n\n## Section 2\n\nMore content here.`;
    const deep = `# Title\n\n## Section 1\n\n### Subsection\n\n#### Detail\n\nContent here with enough words to pass the minimum threshold for word count normalization.\n\n## Section 2\n\nMore content here.`;

    const flatScore = computeQualityScore({ markdown: flat });
    const deepScore = computeQualityScore({ markdown: deep });
    expect(deepScore).toBeGreaterThan(flatScore);
  });

  it("rewards code blocks", () => {
    const noCode =
      `# Article\n\nThis article discusses programming concepts in detail with sufficient length to score.` +
      "\n\n".repeat(5) +
      "More text. ".repeat(50);
    const withCode =
      noCode + "\n\n```typescript\nconst x = 1\n```\n\n```typescript\nconst y = 2\n```";

    expect(computeQualityScore({ markdown: withCode })).toBeGreaterThan(
      computeQualityScore({ markdown: noCode }),
    );
  });

  it("rewards external links", () => {
    const noLinks = `# Article\n\n` + "Content paragraph. ".repeat(50);
    const withLinks =
      noLinks + "\n\nSee [docs](https://example.com) and [source](https://github.com/example).";

    expect(computeQualityScore({ markdown: withLinks })).toBeGreaterThan(
      computeQualityScore({ markdown: noLinks }),
    );
  });

  it("returns value between 0 and 1", () => {
    const massive =
      "## Heading\n\n" +
      "[link](https://example.com) ".repeat(500) +
      "\n\n```js\ncode\n```\n".repeat(20) +
      "\n\n![img](https://example.com/img.png)\n".repeat(20);
    const score = computeQualityScore({ markdown: massive });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
