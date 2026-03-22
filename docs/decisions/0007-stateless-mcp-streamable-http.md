---
status: "proposed"
date: 2026-03-22
decision-makers: ryo-morimoto
---

# Use stateless Worker for MCP Streamable HTTP transport

## Context and Problem Statement

MCP（Model Context Protocol）14+2ツールのトランスポート層をCloudflare Workers上でどう実装するか。

## Decision Drivers

* MCP Streamable HTTP仕様がステートレスHTTPを前提としている
* Workers上で自然にスケールすること
* Claude Code（MCPクライアント）が短いリクエスト/レスポンスで完結

## Considered Options

* ステートレスWorker（`/mcp` Honoルート）
* Durable ObjectsでMCPセッション管理

## Decision Outcome

Chosen option: "ステートレスWorker", because Streamable HTTP仕様自体がステートレス設計であり、Durable Objectsは過剰。

### Consequences

* Good, because Workersの自動スケールがそのまま活きる
* Good, because 実装量が小さい（Honoルート追加のみ）
* Bad, because MCP仕様がセッション状態を要求するよう進化した場合、DOに移行が必要
* Neutral, because 認証はBearer token（API Key）+ Cloudflare Access（ブラウザ）の併用

### Confirmation

P3で実装予定。本ADRは設計判断のみ。
