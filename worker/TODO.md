# TODO

## 1. パイプラインバグ — 記事が検索から不可視

### Why

FTSインデックスが構築されていない記事が存在し、タイトル完全一致でも検索結果に出ない。記事は存在するのに発見できない。パイプラインのどこかでエンリッチメントが漏れている。

### What

- **FTSインデックス未構築**: Zach Tellman全10記事が `title_tokens: null`, `full_text_tokens: null`, `trigrams_at: null`。EnrichWorkflow のトークナイズが走っていない
- **full_text が null**: RSSフィードが `content:encoded` ではなく `description` に全文HTMLを入れているケースで、パーサーが full_text として認識できていない。結果として FTS も embedding もスキップされる
- **URLが相対パス**: Zach Tellmanの記事が `/essays/senior-engineers-reduce-risk.html` のように返る。フィードパース時の base URL 結合が一部のフィードで効いていない

---

## 2. データ品質 — 記事メタデータに欠陥がある

### Why

検索やレコメンドの出力を見ても、データの問題で判断できない。HTMLが混入した excerpt、日付なしの記事、スコアなしの記事が大量にある。

### What

- **excerpt に HTML タグが残っている**: `<p>`, `<a>`, `<code>`, `<sup>` がそのまま。プレーンテキストとして使えない
- **published_at が null の記事がある**: ソート結果が壊れる。レコメンドの recency 計算も影響を受ける
- **quality_score が null の記事が大量**: Zach Tellman全記事、Oskar Dudycz全記事など。full_text が null なので compute_quality がスキップされている（パイプラインバグの連鎖）

---

## 3. 検索精度 — semantic 検索が期待通りに機能しない

### Why

embedding ベースの検索を入れたが、結果の質がキーワード部分一致レベル。"building products user pain points shipping" で Rust DI や ChromeOS Flex の記事が返る。

### What

- **意味的検索の精度が低い**: embedding が title + excerpt（短い）で生成された既存記事が大半。re-embed migration が適用されていない、または re-embed が完走していない可能性
- **ランキング融合が不透明**: FTS スコアと semantic 類似度のどちらが支配的か、結果から判断できない。デバッグ手段がない

---

## 4. レコメンド — スコアリングが機能していない

### Why

get_recommended の上位記事のスコアがほぼ均一（0.0294〜0.0294）。事実上ランダム。

### What

- **quality_score の算出ロジックが疑わしい**: ChromeOS Flex の記事（0.749）が Dan Abramov の useEffect 記事（0.695）より高い。文章の構造だけで算出しており、内容の質を反映していない
- **engagement データがゼロ**: read/like/bookmark が蓄積されていないので interest score が計算できず、全フィードが floor 値（0.1）
- **published_at null の記事がレコメンドに混入**: recency decay の計算が壊れる

---

## 5. フィード管理 — ライフサイクル管理ができない

### Why

フィードを追加した後の運用手段が足りない。間違って追加したフィードが消せない、壊れたフィードのリカバリ手段がない。

### What

- **フィードの削除ができない**: `add_feed` と `disable_feed` はあるが `remove_feed` がない。ゾンビフィードが残り続ける
- **エラー状態のフィードが放置される**: `error_count: 3` / `last_error: "HTTP 404"` のフィードが大量。通知もリトライ上限変更もない
- **フィードURLの更新**: `update_feed` で `rss_url` 変更は可能になったが、エラーカウントのリセットが連動しない

---

## 6. 読書ワークフロー — bulk 操作と状態管理

### Why

3000+記事を効率的に処理する手段がない。1記事ずつの操作しかなく、読書ワークフローに合わない。

### What

- **bulk 操作がない**: 「このフィードを全部既読にする」「1週間前の記事をすべて既読にする」ができない
- **状態が少ない**: read/unread + bookmark + like のみ。「後で読む」「読みかけ」「重要」がない

---

## 7. カテゴリ / 分類 — トピック探索手段がゼロ

### Why

フィードを横断的にグルーピングして探索する手段がない。ADR-0013 の Step 2（トピックタグ抽出）が未実装。

### What

- **カテゴリ機構が未使用**: 全フィードの `category_id: null`。`update_feed` でカテゴリ割当は可能になったが、カテゴリ自体が未定義
- **記事のタグ / トピック分類がない**: 自動タグ付けなし、手動タグもなし

---

## 8. API / ツール設計 — LLM 連携で非効率

### Why

MCP ツール経由で使う場合、API の設計が LLM の利用パターンに合っていない。

### What

- **get_article のレスポンスが巨大**: full_text + excerpt（HTML全文）で1記事数万トークン。LLM のコンテキストを圧迫する
- **list_articles の sort オプションが少ない**: `published_at` と `score` のみ。`quality_score` 順、`fetched_at` 順がない
- **search と list が分離**: 「feed_id=16 かつ unread かつ キーワードX」のような複合条件が一発で書けない
