---
status: "accepted"
date: 2026-03-22
decision-makers: ryo-morimoto
---

# Use GitHub OAuth via @cloudflare/workers-oauth-provider for single-user auth

## Context and Problem Statement

claude.ai の Remote MCP 接続は OAuth 2.1 必須。既存の Bearer token（API Key）認証では接続できない。
自分専用のRSSリーダーなので、認証は最小構成でよい。

## Decision Drivers

* claude.ai が OAuth 2.1 (PKCE + Dynamic Client Registration) を要求する
* 自分1人しか使わない → マルチユーザー設計は不要
* Cloudflare Workers 上で完結させたい
* 既存の Bearer token 認証を置き換える（OAuth に一本化）

## Considered Options

* `@hono/mcp` の `mcpAuthRouter` + カスタム `OAuthServerProvider`
* `@cloudflare/workers-oauth-provider` で Worker 全体をラップ
* OAuth なし（Bearer token のまま、claude.ai は諦める）

## Decision Outcome

Chosen option: "`@cloudflare/workers-oauth-provider`", because OAuth サーバーの実装（コード生成、PKCE 検証、トークンハッシュ保管、クライアント登録、リフレッシュ）を全て委譲できる。自前で書くのは GitHub OAuth のリダイレクトとコールバックのみ。

`@hono/mcp` の `mcpAuthRouter` はルーティングは提供するが、トークン管理・PKCE 検証・クライアント登録ストレージを全て自前実装する必要があり、コストが大きい。

### Implementation

**アーキテクチャ:**

```
export default new OAuthProvider({
  apiHandlers: { '/mcp': McpApiHandler, '/api/': ApiHandler },
  defaultHandler: { fetch: ... }  // /authorize, /callback
})
```

* `OAuthProvider` が Worker エントリポイントをラップ
* `/mcp` と `/api/` は `apiHandlers` で OAuth 保護
* `/authorize` → GitHub OAuth にリダイレクト（`GITHUB_CLIENT_ID` を使用）
* `/callback` → GitHub トークン交換 → ユーザー名検証（`GITHUB_ALLOWED_USERNAME`）→ `completeAuthorization()`
* `OAUTH_KV`（KV Namespace）にトークン・クライアント情報を保管

**Bearer token 廃止:**

* `auth/bearer.ts` と `requireScope` ミドルウェアを削除
* 全ルートの認証を OAuthProvider に委譲
* API ルートは `createApiApp(guard)` ファクトリで認証ガードを注入（テスト時はパススルー）

**テスト設計:**

* Integration テストは `createApiApp(passthrough)` で Hono app を直接テスト（OAuth バイパス）
* MCP テストは `InMemoryTransport` で `createMcpServer` を直接テスト
* OAuth フロー自体のテストは E2E で補完

### Consequences

* Good, because claude.ai から MCP 接続が可能になる
* Good, because OAuthProvider がトークン管理を全て処理（PKCE, ハッシュ, リフレッシュ, クライアント登録）
* Good, because 認証方式が OAuth に一本化（Bearer token との二重管理を排除）
* Bad, because Worker エントリポイントが `OAuthProvider` ラッパーになり、Hono app が直接 `export default` できない
* Bad, because KV Namespace (`OAUTH_KV`) の追加依存
* Neutral, because GitHub OAuth App の手動作成と secrets 管理（`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_ALLOWED_USERNAME`）が必要

### Confirmation

本番デプロイ済み（2026-03-22）。OAuth Discovery、401 強制、GitHub 認証フローを動作確認。
