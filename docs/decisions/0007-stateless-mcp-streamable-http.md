---
status: "accepted"
date: 2026-03-22
decision-makers: ryo-morimoto
---

# Use stateless Worker for MCP Streamable HTTP transport

## Context and Problem Statement

MCP（Model Context Protocol）ツールのトランスポート層をCloudflare Workers上でどう実装するか。

## Decision Drivers

* MCP Streamable HTTP仕様がステートレスHTTPを前提としている
* Workers上で自然にスケールすること
* Claude Code / claude.ai の両方から接続できること

## Considered Options

* ステートレスWorker（`/mcp` エンドポイント）
* Durable ObjectsでMCPセッション管理

## Decision Outcome

Chosen option: "ステートレスWorker", because Streamable HTTP仕様自体がステートレス設計であり、Durable Objectsは過剰。

### Implementation

* `@hono/mcp` の `StreamableHTTPTransport` を使用（Hono Context をそのまま渡せる）
* `enableJsonResponse: true` でSSEではなくJSON応答（ステートレスWorkerと相性がよい）
* リクエストごとに `McpServer` + `Transport` を生成（`sessionIdGenerator: undefined`）
* `McpApiHandler`（`WorkerEntrypoint`）経由で `OAuthProvider` の `apiHandlers` に接続
* 12ツール実装: get_feeds, get_categories, get_article, list_articles, get_reading_stats, get_recent_activity, get_user_preferences, mark_as_read, toggle_bookmark, toggle_like, search_articles, get_similar_articles
* summarize_article / translate_article は AI adapter 未決定のため除外（当初計画の14ツールから12ツールに）

### Consequences

* Good, because Workersの自動スケールがそのまま活きる
* Good, because `@hono/mcp` で fetch-to-node 変換が不要
* Bad, because サーバー起動通知（sampling, elicitation）は不可（SSEストリームなし）
* Bad, because MCP仕様がセッション状態を要求するよう進化した場合、DOに移行が必要

### Confirmation

P3で実装完了。本番動作確認済み（2026-03-22）。
