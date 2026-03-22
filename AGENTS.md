# Oksskolten

AI-native RSS reader. [babarot/oksskolten](https://github.com/babarot/oksskolten) の Fork。

## このリポジトリの目的

Fork元を Cloudflare 上で展開・運用できるようにすること。Cloudflare のプリミティブ（D1, Workers, Workflows, Containers, Vectorize, Cron Triggers）で最適に動作するよう、代替実装や機能追加を行う。

## ディレクトリと所有者

| ディレクトリ | 所有者 | 説明 |
|---|---|---|
| `worker/` | **このリポジトリ** | Cloudflare Workers 版の実装（本番稼働中） |
| `server/` | Fork元 | Node.js/Fastify 版（参照用、最終的に削除予定） |
| `client/` | Fork元 | フロントエンド（参照用） |
| `docs/decisions/` | **このリポジトリ** | CF版の ADR・設計判断。MADR 4.0 形式 |
| `docs/adr/` | Fork元 | Fork元由来の ADR（001, 002）。ここには追加しない |
| `docs/spec/` | Fork元 | Fork元の機能仕様 |

## Architecture

Worker版は Hono + D1 + Workflows + Containers + Cron Triggers で構成。`wrangler deploy` 一発でデプロイ。

## Worker development

```bash
cd worker
npm install
npm run dev      # wrangler dev (predev で defuddle bundle 自動生成)
npm test         # vitest run (pretest で defuddle bundle 自動生成)
npm run deploy   # wrangler deploy
```

## Database

D1 (managed SQLite). マイグレーションは `worker/migrations/` に配置。

- **SELECT**: `FROM active_articles` VIEW を使う（soft-delete の `purged_at IS NULL` フィルタが組み込み）
- **INSERT / UPDATE / DELETE**: `articles` テーブルに直接（D1 は VIEW 経由の書き込み不可）
- **`purged_at IS NULL` をアプリコードに書かない** — VIEW に委ねる

## ADR

- `docs/adr/` — Fork元由来の ADR（001, 002）。ここには追加しない
- `docs/decisions/` — CF版の ADR。MADR 4.0 形式。新規はここに追加

ファイル命名: `NNNN-title-with-dashes.md`

## Defuddle bundle

`defuddle/node` は CJS で配布されており workerd で直接動かない。esbuild で ESM に pre-bundle する。

- バンドルは `worker/src/lib/defuddle-bundle.mjs`（gitignored、自動生成）
- `pretest` / `predev` / `predeploy` で自動実行（lockfile より新しければスキップ）
- defuddle アップグレード後は `node scripts/bundle-defuddle.mjs` で再生成（自動）

## Testing

`@cloudflare/vitest-pool-workers` v0.13+ (Vitest 4.x)。全テスト workerd 内で実行。

- `cloudflare:workers` の `env` / `exports` を使う（`cloudflare:test` は deprecated）
- `exports.default.fetch(new Request(...))` で HTTP テスト
- D1 は Miniflare のインメモリ SQLite（mock しない）
- テスト間のデータは `DELETE FROM` でクリア（AUTOINCREMENT カウンタはリセットされない → ID をハードコードしない）
- FTS5 テスト: `setupTestDb()` で `rebuild` コマンドを先に実行（SQLITE_CORRUPT 防止）

## Module boundaries

モジュール分割の基準（[ADR-0008](docs/decisions/0008-module-boundary-criteria.md)）:

1. **将来別の実装に切り替える可能性がある部分** — ライブラリ境界として切り出す
2. **Deep module** — 複雑な実装を単純なインターフェースの裏に隠す価値がある部分

オーケストレーションコード（手順を上から順に呼ぶだけ）は長くても分割しない。

## Workflows + Containers

パイプラインは Cloudflare Workflows で実装（[ADR-0009](docs/decisions/0009-workflows-migration.md)）。

- **Workflow ステップ内から Container (DO) を呼ぶ場合、1記事1ステップに分離する** — 1つの `step.do` 内で複数のDO間通信をするとデッドロックする
- `step.do('tokenize_${id}')` のように動的ステップ名を使う場合、名前は前ステップの永続化済み戻り値から導出する（決定論的でなければリプレイが壊れる）
- Container cold start は 20-30秒 — tokenize ステップの timeout は `2 minutes` に設定
- FTS5 外部コンテンツテーブルの同期トリガーは `COALESCE(col, '')` で NULL を正規化する（WHEN ガードは使わない）
- FTS5 delete は `INSERT INTO fts(fts, rowid, ...) VALUES('delete', ...)` 構文を使う（通常の DELETE は外部コンテンツテーブルでは効かない）

## Search

FTS5 + Vectorize (bge-m3) + RRF ハイブリッド検索（[ADR-0010](docs/decisions/0010-bge-m3-embedding-model.md)）。

- `articles_fts` は `content=articles, content_rowid=rowid` の外部コンテンツテーブル
- 検索 API は FTS5 MATCH + Vectorize cosine similarity を並列実行 → RRF (k=60) でマージ
- `score(doc) = Σ 1/(60 + rank_i) + log(1 + engagement) * 0.01`
- Vectorize 結果は `active_articles` JOIN で purged 記事を除外
- FTS5 MATCH 入力はサニタイズする（AND/OR/NOT/*/^/()/" を除去）
- trigram 補正は FTS5 側にのみ適用（Vectorize はセマンティックなので不要）
- pagination は fusion 後に適用（FTS5/Vectorize はそれぞれ LIMIT 100 で大きく取得）
- Hono のルート登録: `/articles/:id{[0-9]+}` に regex 制約をつけて `/articles/search` との競合を防止

## E2E テスト

本番 URL に HTTP リクエストを投げて検証。AI/Vectorize binding はテスト環境に存在しないため E2E で補完。

```bash
OKSSKOLTEN_API_KEY=ok_... npm run test:e2e
```

- `vitest.config.e2e.ts` — Node.js 実行（workerd pool ではない）
- `test/e2e/` — smoke / search / pipeline
- `vitest.config.ts` の `exclude` で E2E を除外（`npm test` では実行されない）
- テスト用 wrangler config: `wrangler.test.toml`（AI/Vectorize binding 除外）
