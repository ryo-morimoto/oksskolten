# Oksskolten

AI-native RSS reader. Fork of [babarot/oksskolten](https://github.com/babarot/oksskolten), rebuilt on Cloudflare.

## Architecture

Two codebases coexist:

- `server/` — Fork元のNode.js/Fastify版（参照用、最終的に削除予定）
- `worker/` — Cloudflare Workers版（本番稼働中）

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

FTS5 + trigram 辞書による日本語全文検索。

- `articles_fts` は `content=articles, content_rowid=rowid` の外部コンテンツテーブル
- 検索 API は `active_articles` VIEW と `JOIN ON a.id = fts.rowid` する（VIEW には rowid がないため `id` を使う）
- FTS5 MATCH 入力はサニタイズする（AND/OR/NOT/*/^/()/" を除去）
- Hono のルート登録: `/articles/search` は `/articles/:id{[0-9]+}` より先に登録するか、`:id` に regex 制約をつける
