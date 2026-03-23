---
status: proposed
date: 2026-03-23
decision-makers: ryo-morimoto
---

# Use MCP Apps with shadcn/ui for interactive article cards in chat

## Context and Problem Statement

MCP ツールの結果がプレーンテキスト JSON で返されるため、記事一覧の視認性が低く、ブックマーク/既読などのインタラクションができない。claude.ai の会話内にリッチな UI を表示したい。

## Decision Drivers

- claude.ai の会話内でインタラクティブに操作できること
- shadcn/ui の polish されたコンポーネントを使いたい
- 将来 P5（独立フロントエンド）でコンポーネントを再利用できること
- バンドルサイズが小さく初回表示が速いこと

## Considered Options

1. MCP Apps — HTML バンドルを `ui://` リソースで配信
2. json-render — コンポーネントカタログ + JSON spec
3. プレーンテキスト強化（Markdown テーブル等）
4. P5 フロントエンド先行（Pages + shadcn/ui）

## Decision Outcome

**Option 1: MCP Apps**

claude.ai が公式サポート済み。iframe サンドボックスでセキュア。React + shadcn/ui を Vite で単一 HTML にバンドルし、`ui://` リソースとして配信する。

### Why not json-render

コンポーネント種類が少ない（記事カード程度）ためカタログ化の旨味がない。将来コンポーネント数が増えたら再検討。

### Consequences

- Good: claude.ai、Claude Desktop、VS Code Copilot で動作
- Good: shadcn/ui の既存コンポーネント（Card, Button, Badge）をそのまま利用
- Good: `ArticleCard.tsx` は将来 `packages/ui/` に移動するだけで P5 と共有可能
- Bad: Worker から HTML バンドルを配信する仕組みが必要
- Bad: iframe 内は閉じた世界のため外部リソースに CSP 設定が必要

## Architecture

```
claude.ai
  └── iframe (sandboxed)
        └── ui/dist/index.html (React + shadcn/ui)
              ↕ postMessage (JSON-RPC)
claude.ai host
  ↕ MCP protocol
Worker (OAuthProvider)
  └── McpApiHandler
        ├── tools/call: get_recommended → 記事データ JSON
        └── resources/read: ui://recommended-articles → HTML バンドル
```

### Communication flow

1. LLM が `get_recommended` を呼ぶ
2. ホストが `_meta.ui.resourceUri` から HTML をプリロード
3. ツール結果（記事 JSON）が iframe に push される
4. ユーザーがブックマークボタン押下 → iframe → host → MCP `toggle_bookmark` → 結果が iframe に戻る → UI 更新

### File structure

```
worker/ui/                    # MCP Apps フロントエンド（別パッケージ）
├── src/
│   ├── App.tsx               # MCP Apps エントリ（postMessage 通信）
│   └── components/
│       └── ArticleCard.tsx   # shadcn/ui ベースのカード
├── index.html
├── vite.config.ts            # 単一 HTML バンドル (vite-plugin-singlefile)
└── package.json              # React, shadcn/ui, tailwind
```

## Incremental steps

1. **Now**: `get_recommended` に MCP Apps UI を追加 — 記事カード一覧 + ブックマーク/既読ボタン
2. **When 他のツールも UI が欲しくなったとき**: `list_articles`, `search_articles` にも同じ UI リソースを共有
3. **When P5 を始めるとき**: shadcn/ui コンポーネントを `packages/ui/` に切り出して MCP Apps と Pages で共有
4. **When ホスト間の差異が問題になったとき**: テーマ対応、レスポンシブ調整

## Known edge cases (not solving now)

- 記事 0 件の空状態表示
- 大量記事（100+）のページネーション UI
- ダークモード / ホストのテーマとの整合
- オフライン時の状態
- claude.ai 以外のホスト（Claude Desktop, VS Code）での表示差異
- 記事の full_text Markdown プレビュー
