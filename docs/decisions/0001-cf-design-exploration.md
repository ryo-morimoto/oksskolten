# ADR-003: Cloudflare移行 — 設計空間の探索

> Date: 2026-03-22
> Status: Deprecated — superseded by `docs/decisions/0002-0008`
> Scope: ADR-001 (Architecture Intent) の各領域に対する具体的な設計アプローチの比較
>
> **Note:** This document served as a design exploration workspace during P0.
> Individual decisions have been extracted into MADR 4.0 format in `docs/decisions/`.
> This file is kept for historical reference only.

---

## 目的

ADR-001で定義した6つの設計領域について、アプローチの選択肢・トレードオフ・判断ポイントを整理する。
各領域で方向性を決定した後、個別のADRとして確定する。

---

## 1. プロジェクト構造

### Approach A: Monolith Worker

1つの `wrangler.toml` に全バインディング（D1, R2, Queue, Vectorize）を定義。
HonoでAPI・Queue consumer・Cron Triggerを1つのWorkerに集約する。

- **Strength:** デプロイが1コマンド。コード共有が自然。Fork元の単一プロセス構造に最も近い
- **Cost:** Workerのバンドルサイズ上限（10MB圧縮後）に将来ぶつかる可能性。全バインディングが1つのWorkerに集中
- **Fits when:** 機能が安定していて、ワーカー分離の必要がないとき

### Approach B: Multi-Worker

`api-worker`（Hono API + Pages）、`pipeline-worker`（Queue consumer群）、`container`（kuromoji）の3デプロイ。
monorepoでコード共有。

- **Strength:** 各Workerが独立してスケール。バンドルサイズ問題を回避。関心の分離が明確
- **Cost:** デプロイが複数ステップ。Worker間の型共有に仕組みが必要。開発時のローカル再現が複雑
- **Fits when:** パイプラインとAPIのライフサイクルが異なるとき

### Approach C: Service Bindings

BのMulti-Workerに加え、Worker間をService Bindingsで接続。
外部HTTPではなくV8内部呼び出し。

- **Strength:** Worker分離のメリット + ゼロレイテンシ内部通信。型安全なRPC（`wrangler types` で自動生成）
- **Cost:** Service Bindings固有の制約（リクエストサイズ、コールチェーン深度）。ローカル開発では `wrangler dev --remote` が必要な場面がある
- **Fits when:** Worker間通信が頻繁で、レイテンシが重要なとき

### ディレクトリ構造（B/C選択時）

```
oksskolten-cf/
├── apps/
│   ├── api/              # Hono Workers (API + MCP + Queue consumer)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── mcp/
│   │   │   ├── queue/
│   │   │   └── index.ts
│   │   └── wrangler.toml
│   ├── container/        # kuromoji Container
│   │   ├── src/
│   │   └── Dockerfile
│   └── web/              # React frontend (Pages)
│       ├── src/
│       └── vite.config.ts
├── packages/
│   ├── db/               # D1 schema, queries, types
│   │   ├── migrations/
│   │   └── src/
│   ├── shared/           # Shared types, utils
│   └── content/          # Defuddle + linkedom wrapper
├── turbo.json
└── pnpm-workspace.yaml
```

---

## 2. パイプラインのQueue分割

### Approach A: 4段階（ADR-001そのまま）

```
Cron → Worker A (フィードリスト) → Q1
     → Worker B (fetch + parse)  → Q2
     → Worker C (Defuddle)       → Q3
     → Worker D (batch index: kuromoji + FTS5 + Vectorize)
```

- **Strength:** 各段階が壁時間30秒以内に確実に収まる。段階ごとのリトライが独立
- **Cost:** Queue 4つの管理。段階間のデータ受け渡し設計が必要。デバッグ時にメッセージの追跡が煩雑
- **Fits when:** フィード数が100+で、各段階の処理時間が予測しにくいとき

### Approach B: 3段階（fetch+parseとDefuddleを統合）

```
Cron → Worker A (フィードリスト) → Q1
     → Worker B (fetch + parse + Defuddle) → Q2
     → Worker C (batch index)
```

- **Strength:** Queueが1つ減る。fetch→Defuddleは1記事あたり1-3秒で30秒に余裕で収まる。データ受け渡しが1回減る
- **Cost:** Worker Bの処理時間が長くなる（ただし1記事単位なので問題なし）
- **Fits when:** Defuddleがlinkedom上で十分高速なとき（Workers上で100-200ms想定）

### Approach C: 2段階（最小構成）

```
Cron → Worker A (フィードリスト → 各フィードをQ1に)
     → Worker B (fetch + parse + Defuddle + D1保存 → Q2に)
     → Worker C (batch: kuromoji + FTS5 + Vectorize)
```

- **Strength:** 最小構成。記事のD1保存をindexの前に完了するので、検索インデックスが遅延しても記事はInboxで閲覧可能
- **Cost:** Worker Bがやや重い（ただしD1書き込みは数msなので実質Bと変わらない）
- **Fits when:** シンプルさを優先するとき

### 共通の設計判断

| 判断 | 選択肢 | 備考 |
|---|---|---|
| **メッセージ形式** | メタデータのみ（本文はD1/R2経由） vs 本文ごとキュー経由 | Queue最大メッセージ128KB。記事本文は超える可能性あり → メタデータのみが安全 |
| **冪等性** | 記事URLをキーとするupsert | Queuesはat-least-once配信。重複処理を前提に設計 |
| **Dead Letter** | 3回失敗 → DLQ → アラート | Worker上の通知手段: R2にログ or 外部Webhook |
| **バッチサイズ** | Worker C/D: max_batch_size=20, max_wait_seconds=60 | ADR-001のまま |
| **順序保証** | 不要 | 記事の到着順に意味はない |
| **フィードごとの並列度** | Queueが自動管理（max_concurrency設定可） | Fork元のSemaphore(5)に相当 |

---

## 3. ハイブリッド検索

### Approach A: 3層 + RRF（ADR-001そのまま）

```
Layer 1: D1 FTS5 (kuromoji tokenized)
Layer 2: trigram辞書 (typo tolerance)
Layer 3: Vectorize + PLaMo-Embedding-1B (semantic)
Merge:   Reciprocal Rank Fusion (k=60) + engagement boost
```

- **Strength:** キーワード・タイポ・意味の3軸をカバー。各層の責務が明確
- **Cost:** 検索時に3バックエンドを叩く。レイテンシが合算（並列化で緩和）
- **Fits when:** 検索品質が最重要で、レイテンシ100ms程度を許容するとき

### Approach B: 2層（FTS5 + Vectorize、trigramなし）

- **Strength:** 最小構成。Vectorizeのembeddingがタイポもある程度吸収する
- **Cost:** `io_uing` → `io_uring` のようなタイポ補正は弱い
- **Fits when:** タイポ補正の優先度が低いとき（自分のツールなら自分のタイポ傾向は限定的）

### Approach C: FTS5単体から始めて段階的に追加

- **Strength:** P0で検索がすぐ動く。Layer 2, 3は後から追加可能（FTS5スキーマ変更不要）
- **Cost:** 初期はキーワード一致のみ
- **Fits when:** 段階的デリバリーを重視するとき

### FTS5トークナイズの具体設計

D1のFTS5はカスタムトークナイザを登録できない。
kuromoji出力をスペース区切りテキストとして格納し、FTS5の `unicode61` トークナイザがそれを単語単位に分割する。

```sql
-- 前処理カラム方式
ALTER TABLE articles ADD COLUMN title_tokens TEXT;
ALTER TABLE articles ADD COLUMN full_text_tokens TEXT;

-- kuromoji出力をスペース区切りで格納
-- 例: "東京都の天気" → "東京 都 天気"（助詞「の」は品詞フィルタで除去）

CREATE VIRTUAL TABLE articles_fts USING fts5(
  title_tokens, full_text_tokens,
  content=articles, content_rowid=rowid,
  tokenize='unicode61'
);
```

### trigram辞書の設計（Approach A選択時）

```sql
-- kuromojiが抽出した名詞を辞書に蓄積
CREATE TABLE term_dictionary (
  id INTEGER PRIMARY KEY,
  term TEXT UNIQUE NOT NULL,
  frequency INTEGER DEFAULT 1
);

-- 各termのtrigramを分解して格納
CREATE TABLE term_trigrams (
  trigram TEXT NOT NULL,
  term_id INTEGER NOT NULL REFERENCES term_dictionary(id),
  PRIMARY KEY (trigram, term_id)
);
CREATE INDEX idx_trigrams ON term_trigrams(trigram);

-- 検索時のフロー:
-- 1. 完全一致チェック: SELECT FROM term_dictionary WHERE term = ?
-- 2. 不一致 → trigram照合: クエリをtrigramに分解 → 一致数でランキング
-- 3. 補正候補で FTS5 MATCH
-- 追加レイテンシ: 正しいスペル <1ms / タイプミス <5ms
```

### RRFマージの設計（Approach A選択時）

```
score(doc) = Σ 1/(k + rank_i(doc))  where k=60
           + engagement_boost(doc)

engagement_boost = log(1 + engagement_score) * 0.01
```

- FTS5, trigram, Vectorize の各結果を並列に取得
- 各結果セット内の順位（rank）のみ使用（スコア値は無視）
- engagement_scoreをブースト項として加算し、よく読まれる記事を浮上

---

## 4. コンテンツ抽出

### Approach A: Worker内で完結（linkedom + Defuddle）

- **How:** `linkedom` でDOM構築 → `Defuddle` で抽出 + Markdown変換。全てWorker内（`nodejs_compat`）
- **Strength:** 外部依存なし。レイテンシ最小。Defuddleはlinkedomを推奨DOMとして設計
- **Cost:** Workerのメモリ上限128MBの中でDOM構築が必要。巨大ページ（>5MB HTML）でOOMリスク
- **Fits when:** 大半の記事ページ（<1MB HTML）

### Approach B: Worker + Browser Rendering APIフォールバック

- **How:** Aに加え、JS必須ページのみBrowser Rendering APIで実行。`requires_js_challenge` フラグで判別
- **Strength:** FlareSolverrの代替。Cloudflare内で完結
- **Cost:** Browser Rendering APIの料金（Workers Paid: 月5,000回無料、超過$0.01/page）。コールドスタートあり
- **Fits when:** JS-renderedサイトも購読するとき

### Approach C: Container内でDefuddle（jsdom使用）

- **How:** kuromoji Containerの中でjsdomベースのDefuddleも実行。Workerは記事URLだけ送る
- **Strength:** メモリ制約なし。jsdom使用で互換性最大
- **Cost:** Containerへの依存が増える。レイテンシ増加。Containerがボトルネック化
- **Fits when:** linkedomの互換性問題が頻発するとき

### パイプライン比較

```
Fork元:       fetch → jsdom → preClean(150 selectors)
              → Readability → postClean(400 selectors)
              → Turndown → Markdown

Approach A/B: fetch → linkedom → Defuddle → Markdown
              JS必須時 → Browser Rendering API → linkedom → Defuddle

Approach C:   fetch → Container(jsdom → Defuddle → Markdown)
```

### Fork元の500パターンnoise removalの扱い

| 方針 | 説明 | リスク |
|---|---|---|
| **捨てる** | Defuddleのビルトイン除去に委ねる | 一部サイトでノイズ残存。発生ベースで対応 |
| **段階的移行** | Defuddleで不足した場合のみFork元から最頻出パターンを追加 | 中途半端な状態が長く続く可能性 |
| **全移行** | selectors.tsをDefuddleのpre/post hookに組み込む | Defuddleの設計思想（寛容な抽出）と競合。メンテコスト維持 |

Defuddleの設計思想は「寛容な抽出 + マルチパスリカバリ」。
Fork元の500パターンの大半はDefuddleが内包する。**捨てる → 問題ベースで追加**が最もシンプル。

---

## 5. MCP Streamable HTTP

### Approach A: 単一Workerエンドポイント（ステートレス）

- **How:** `/mcp` エンドポイントにHonoルートを追加。各リクエストが独立。セッション管理はクライアント側
- **Strength:** Workers上で自然。スケール問題なし。Streamable HTTPの設計意図（ステートレスHTTP）にマッチ
- **Cost:** ツール実行結果のストリーミング（SSE部分）はWorkerで可能だが、長時間ストリームはCDNタイムアウトに注意
- **Fits when:** MCPクライアントがClaude Codeのように短いリクエスト/レスポンスで完結するとき

### Approach B: Durable ObjectsでMCPセッション管理

- **How:** MCPセッションをDurable Objectに紐づけ。WebSocket or SSE over DO
- **Strength:** セッション状態の永続化。長時間の会話コンテキスト維持
- **Cost:** DOの複雑さ。Streamable HTTPトランスポートはステートレス設計なのでオーバーエンジニアリング
- **Fits when:** MCP仕様がセッション状態を要求する将来（現時点では不要）

### MCPツール移行マトリクス

| ツール | 移行難易度 | 理由 |
|---|---|---|
| get_article | 低 | D1 SELECTのみ |
| get_feeds | 低 | D1 SELECT |
| get_categories | 低 | D1 SELECT |
| get_reading_stats | 低 | D1集計クエリ |
| mark_as_read | 低 | D1 UPDATE |
| toggle_like | 低 | D1 UPDATE |
| toggle_bookmark | 低 | D1 UPDATE |
| get_user_preferences | 低 | D1集計クエリ |
| get_recent_activity | 低 | D1集計クエリ |
| search_articles | **中** | Meilisearch → FTS5 + Vectorize への書き換え |
| get_similar_articles | **中** | Vectorize cosine similarity |
| summarize_article | **中** | AI adapter移行（Workers AI or 外部API） |
| translate_article | **中** | AI adapter移行 |
| update_user_context | **新規** | D1 + スコアリングロジック |
| get_user_context | **新規** | D1 SELECT |

### 認証

| 方式 | 対象 | 説明 |
|---|---|---|
| **Cloudflare Access** | ブラウザUI | Zero Trustトンネル経由。50 users無料 |
| **Bearer token** | MCP / CLI | Fork元のAPI Key方式（`ok_*` prefix）を踏襲 |

MCPクライアント（Claude Code）からはBearer tokenが自然。
ブラウザUIはCloudflare Accessで保護。**両方**を併用する。

---

## 6. D1スキーマ移行

### Fork元SQLite → D1 の差分

| 項目 | SQLite (Fork元) | D1 | 対応 |
|---|---|---|---|
| WAL mode | 明示的にPRAGMA有効化 | D1が内部管理 | connection.tsのPRAGMA削除 |
| VACUUM | 週次cronで実行 | D1が自動管理 | retention.tsから削除 |
| Foreign Keys | PRAGMA有効化 | デフォルト無効、PRAGMA可 | 維持可能 |
| BLOB列 | credentials.public_key | サポート | そのまま |
| VIEW | active_articles | サポート | そのまま |
| トランザクション | db.transaction() | D1 batch() | API変更が必要 |
| 接続プール | libsql単一接続 | D1バインディング（コネクションレス） | connection.ts全面書き換え |
| FTS5 | 未使用 | サポート | 新規追加 |

### スキーマ追加（CF版で必要）

```sql
-- FTS5用トークン列
ALTER TABLE articles ADD COLUMN title_tokens TEXT;
ALTER TABLE articles ADD COLUMN full_text_tokens TEXT;

-- FTS5仮想テーブル
CREATE VIRTUAL TABLE articles_fts USING fts5(
  title_tokens, full_text_tokens,
  content=articles, content_rowid=rowid,
  tokenize='unicode61'
);

-- trigram辞書（Approach A選択時）
CREATE TABLE term_dictionary (
  id INTEGER PRIMARY KEY,
  term TEXT UNIQUE NOT NULL,
  frequency INTEGER DEFAULT 1
);

CREATE TABLE term_trigrams (
  trigram TEXT NOT NULL,
  term_id INTEGER NOT NULL REFERENCES term_dictionary(id),
  PRIMARY KEY (trigram, term_id)
);

-- user_context（P4）
CREATE TABLE user_context (
  id INTEGER PRIMARY KEY,
  topic TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.5 CHECK(weight >= 0.0 AND weight <= 1.0),
  source TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_context_excludes (
  id INTEGER PRIMARY KEY,
  pattern TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 7. テスト戦略

### テストフレームワーク

`@cloudflare/vitest-pool-workers` v0.13+ (Vitest 4.x) を使用。全テストをworkerdランタイム内で実行する。
D1・Queue・Cronは全てMiniflareが管理するインメモリインスタンスで、本番と同一ランタイムで検証できる。

**v0.13での破壊的変更（実装で判明）:**
- `defineWorkersConfig` → `cloudflareTest` plugin + `defineConfig`
- `cloudflare:test` の `env` / `SELF` → `cloudflare:workers` の `env` / `exports`
- `Cloudflare.GlobalProps.mainModule` 宣言が必要（`exports.default.fetch()` の型解決）

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'))
  return {
    plugins: [
      cloudflareTest({
        main: './src/index.ts',
        wrangler: { configPath: './wrangler.toml' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: { globals: true },
  }
})
```

### テスト環境の型定義 (test/env.d.ts)

```typescript
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      FEED_QUEUE: Queue
      ENVIRONMENT: string
      TEST_MIGRATIONS: D1Migration[]
    }
    interface GlobalProps {
      mainModule: { default: ExportedHandler<Env> }
    }
  }
}
```

### テストヘルパー (test/helpers.ts)

```typescript
import { env } from 'cloudflare:workers'         // not cloudflare:test
import { applyD1Migrations } from 'cloudflare:test'

export async function setupTestDb() {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  // Clear data tables between tests (AUTOINCREMENT counters are NOT reset)
  await env.DB.batch(DATA_TABLES.map(t => env.DB.prepare(`DELETE FROM ${t}`)))
}
```

### HTTP テストパターン

```typescript
import { exports } from 'cloudflare:workers'
// SELF is deprecated — use exports.default.fetch()
const res = await exports.default.fetch(new Request('https://test.host/api/health'))
```

### P0 テスト結果（実装後）

14ファイル / 99テスト / 3.54秒 — 全パス

| テストファイル | テスト数 | 種別 | 検証内容 |
|---|---|---|---|
| `health.test.ts` | 1 | Integration | `GET /api/health` → `{ ok: true }` |
| `migrations.test.ts` | 6 | Integration | テーブル・VIEW存在、active_articles除外、UNIQUE制約 |
| `db-client.test.ts` | 8 | Integration | `bindNamedParams`、`runNamed`/`getNamed`/`allNamed` |
| `bearer-auth.test.ts` | 5 | Integration | 有効Key→200、無効→401、スコープ違反→403 |
| `feeds-api.test.ts` | 12 | Integration | CRUD、duplicate検出、category_id cascade、clip保護 |
| `categories-api.test.ts` | 11 | Integration | CRUD、auto sort_order、collapsed |
| `url-cleaner.test.ts` | 6 | Unit | 60+ trackingパラメータ除去 |
| `schedule.test.ts` | 8 | Unit | `computeInterval` 3シグナル合成、MIN/MAX境界値 |
| `rss-parser.test.ts` | 10 | Unit | RSS 2.0/Atom/RDF parse、tracking URL clean |
| `fetch-feeds.test.ts` | 2 | Integration | Cron handler → 有効フィードだけQueue enqueue |
| `process-feed.test.ts` | 3 | Integration | RSS→D1保存、dedup、304 Not Modified |
| `extract-content.test.ts` | 8 | Unit | Defuddle抽出、fallback、コードブロック変換 |
| `articles-api.test.ts` | 12 | Integration | list/detail、フィルタ、engagement toggle |
| `opml.test.ts` | 5 | Integration | import（カテゴリ作成、重複スキップ）、export |

### テストパフォーマンス最適化（実装で判明）

| 問題 | 対策 |
|---|---|
| defuddle-bundle.mjs (743KB) が全テストで読み込まれる | `process-feed.ts` → `extract-content.ts` のimportを動的importに変更。defuddleを使うテストだけがバンドルを読み込む |
| `pretest` でesbuild毎回実行 | バンドルがlockfileより新しければスキップ |
| `fast-xml-parser` の動的importがworkrdでハング | トップレベルimportに変更 |
| workerdランタイムが各テストファイルごとに起動 | vitest-pool-workers v0.13の仕様。テストファイル数を抑制で対応 |

---

## 8. デプロイ

全コマンドは `worker/` ディレクトリで実行する。

```bash
# 開発（predev でdefuddleバンドル自動生成）
npm run dev               # wrangler dev（ローカルMiniflare）

# テスト（pretest でdefuddleバンドル自動生成）
npm test                  # vitest run（workerd内、3.5秒）

# 本番
npm run deploy            # predeploy → wrangler deploy
npm run d1:migrate:remote # D1マイグレーション適用
```

`defuddle-bundle.mjs` は `predev` / `pretest` / `predeploy` で自動生成される。
lockfileより新しければスキップ（~0ms）。gitにはコミットしない。

---

## 9. P0 実装設計

### Ideal（P0完成時の状態）

- `wrangler deploy` 一発でRSSパイプラインが立ち上がる
- Cron Trigger（毎時）がフィードを巡回し、新着記事をD1に保存する
- 記事はDefuddle + linkedomでMarkdown抽出され、D1に格納される
- Hono APIでフィード管理・記事閲覧・OPML import/exportが動く
- FTS5用の `*_tokens` 列がスキーマに存在する（P1でkuromojiが埋める）
- Queue経由でパイプラインが非同期に回る（2段階）
- 認証はBearer token（API Key方式）で保護される

### Known edge cases (not solving now)

- 巨大HTMLページ（>5MB）でWorkerがOOMする → 発生したらBrowser Rendering検討
- JS-renderedサイトの記事が空になる → RSSの `content:encoded` フォールバックのみ
- RSS Bridgeが使えない → RSS Auto-discoveryのみ
- エンコーディング問題（Shift_JIS等）→ Workers fetch の TextDecoder で要検証
- FlareSolverr代替 → P0スコープ外
- LLMセレクタ推論 → P0スコープ外
- Passkey/GitHub OAuth → P0スコープ外（Bearer tokenのみ）
- フロントエンド → P5
- チャット/AI機能 → P3以降

### P0 完了（2026-03-22）

全5 Stepを実装済み。`worker/` ディレクトリに配置（最終的に `server/` を置き換え予定）。

### ディレクトリ構造（実装後）

```
worker/
├── package.json                     # hono, vitest 4.1, pool-workers 0.13, wrangler 4.76
├── tsconfig.json                    # workers-types + vitest-pool-workers/types
├── wrangler.toml                    # D1, Queue, Cron Trigger
├── vitest.config.ts                 # cloudflareTest plugin + readD1Migrations
├── .gitignore                       # defuddle-bundle.mjs, node_modules, .wrangler
├── scripts/
│   └── bundle-defuddle.mjs          # defuddle/node → ESM pre-bundle (skip if fresh)
├── migrations/
│   └── 0001_initial.sql             # 5テーブル + active_articles VIEW
├── src/
│   ├── index.ts                     # Worker entry: Hono(protectedApi group) + scheduled + queue
│   ├── auth/
│   │   └── bearer.ts                # bearerAuth() + requireScope() Hono middleware
│   ├── db/
│   │   └── client.ts                # bindNamedParams, runNamed, getNamed, allNamed
│   ├── routes/
│   │   ├── health.ts                # GET /api/health (D1接続確認)
│   │   ├── feeds.ts                 # GET/POST/PATCH/DELETE /api/feeds
│   │   ├── categories.ts            # GET/POST/PATCH/DELETE /api/categories
│   │   ├── articles.ts              # GET list/detail, PATCH seen/bookmark/like, POST read
│   │   └── opml.ts                  # GET export, POST import
│   ├── pipeline/
│   │   ├── fetch-feeds.ts           # Cron → Queue enqueue (due判定)
│   │   ├── process-feed.ts          # Queue consumer: fetch→parse→dedup→D1保存→Defuddle
│   │   └── extract-content.ts       # Defuddle(pre-bundled ESM) + Turndown → Markdown
│   └── lib/
│       ├── url-cleaner.ts           # Fork元から移植（変更なし）
│       ├── schedule.ts              # Fork元から移植（変更なし）
│       ├── rss-parser.ts            # feedsmith + fast-xml-parser (FlareSolverr除外)
│       └── defuddle-bundle.mjs      # (generated, gitignored) ESM bundle of defuddle/node
└── test/
    ├── env.d.ts                     # Cloudflare.Env + GlobalProps 型宣言
    ├── helpers.ts                   # setupTestDb, seedFeed, seedApiKey, seedArticle
    ├── unit/                        # 4 files, 32 tests
    └── integration/                 # 10 files, 67 tests
```

### 実装で判明した技術的判断

| 判断 | 詳細 |
|---|---|
| **Defuddle CJS問題** | `defuddle/node` はCJSで配布。workrd (vitest-pool-workers) でそのまま動かない。esbuildでESMにpre-bundleして解決。公式サイトはソースから直接importしているが、npmパッケージ利用者はこの壁にあたる |
| **Turndown DOM依存** | browser版 `turndown.browser.es.js` は `document.implementation.createHTMLDocument` に依存。workrdには `document` がない。linkedomでパースしたDOM Nodeを直接渡すことでHTMLパーサーをバイパス（→ defuddle-bundleに統合） |
| **nodejs_compat** | `compatibility_date >= 2024-09-23` なら `nodejs_compat` だけでv2挙動が自動有効。`nodejs_compat_v2` の明示は不要 |
| **fast-xml-parser 動的import** | `await import('fast-xml-parser')` がworkrdでハング。トップレベルimportに変更で解決 |
| **protectedApi グループ** | Honoの `app.use('/api/feeds/*', bearerAuth())` を繰り返すのではなく、`protectedApi = new Hono()` にミドルウェアを1回適用してグループ化 |
| **D1 AUTOINCREMENT** | `DELETE FROM` でデータを消してもカウンタはリセットされない。テストでハードコードID（`feed_id=1`）は使わず `RETURNING id` で取得 |

---

## 決定事項

2026-03-22 確定。共通原則: **最小構成で始めて、具体的な問題が発生したら拡張する。**

| # | 領域 | 決定 | 理由 | 拡張トリガー |
|---|---|---|---|---|
| 1 | プロジェクト構造 | **A: Monolith → 必要時にB** | 初速優先。分割は後からできる | バンドルサイズ10MB超過時 |
| 2 | パイプライン | **C: 2段階** | Defuddleは決定的関数。分離にリトライ上の意味なし | 各段階が30秒を超えたとき |
| 3 | 検索 | **C: FTS5から段階的** | 各段階が独立して価値を持つ。スキーマはP0で準備 | P1: FTS5+kuromoji、P2: Vectorize、タイポ補正は使用感次第 |
| 4 | コンテンツ抽出 | **A: Worker完結 → 必要時にB** | Defuddle + linkedomが公式推奨構成 | JS-renderedサイト購読時にBrowser Rendering追加 |
| 5 | MCP | **A: ステートレスWorker** | Streamable HTTP仕様がステートレス前提。DOは過剰 | MCP仕様がセッション状態を要求したとき |
| 6 | noise removal | **捨てる** | Defuddleが内包。500パターンのメンテコスト > 個別対応コスト | 問題ベースでDefuddleにcontribute or ローカルhook |

## フェーズ進捗

| Phase | Status | 実績 |
|---|---|---|
| **P0** | **完了・本番稼働** (2026-03-22) | 14ファイル / 99テスト / 3.5秒。本番デプロイ済み。3フィード / 762記事を自動取得 |
| P1 | 未着手 | Container (kuromoji) + D1 FTS5 + trigram辞書 |
| P2 | 未着手 | Vectorize + PLaMo + RRF merge |
| P3 | 未着手 | MCP 14ツール (Streamable HTTP) |
| P4 | 未着手 | user_context API + AI自動トリアージ |
| P5 | 未着手 | フロントエンド (Pages + Hono) |

## 本番環境

| 項目 | 値 |
|---|---|
| URL | `https://oksskolten.ryo-morimoto-dev.workers.dev` |
| D1 | `oksskolten` (53d7ac03-..., APAC/KIX) |
| Queue | `oksskolten-feeds` |
| Cron | `0 * * * *`（毎時） |
| バンドル | 1716 KiB / gzip 381 KiB |
| Startup | 7ms |
| API Key prefix | `ok_0d952060` (scopes: read,write) |

### 初回デプロイ手順（再現用）

```bash
cd worker
npm install
wrangler login
wrangler d1 create oksskolten        # → database_id を wrangler.toml に記入
wrangler queues create oksskolten-feeds
npm run d1:migrate:remote            # D1スキーマ適用

# API Key作成（wrangler d1 execute で直接INSERT）
node -e "(async()=>{
  const key='ok_'+crypto.randomUUID().replace(/-/g,'').slice(0,40)
  const h=Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))).toString('hex')
  console.log('KEY='+key)
  console.log(\`SQL: INSERT INTO api_keys (name,key_hash,key_prefix,scopes) VALUES ('admin','\${h}','\${key.slice(0,11)}','read,write');\`)
})()"
wrangler d1 execute oksskolten --remote --command "<上記SQL>"

npm run deploy
```
