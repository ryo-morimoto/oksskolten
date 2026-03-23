# TODO

## ~~1. Search & Discovery — 検索で目的の記事にたどり着けない~~ ✅

完了: full_text ベース再 embedding、feed_id 絞り込み、per-word trigram 補正、quality_score RRF ブースト。

---

## ~~2. Scoring & Recommendation — レコメンドが機能していない~~ ✅

完了: sort=score を quality_score に置換、RRF に quality boost 追加、コールドスタート時 NULL→0.3 で差別化。

---

## 3. Data Quality — 記事データに欠陥がある

### Why

検索結果やレコメンドの出力を見ても、データ自体の問題で記事の関連性を判断できない。リンクが壊れている、要約が短すぎる、分類がない。

### What

- **一部の記事URLが相対パス**: Zach Tellmanの記事が `/code/the-passport.html` のように返る。フィードパース時に base URL との結合が漏れている
- **excerpt が短すぎる**: 150文字で切られるため検索結果から関連性を判断できない。10件評価するのに11回API呼び出しが必要
- **カテゴリが未定義**: `get_categories` は存在するが category_id が全フィード null。フィードをトピックでグルーピングする手段がない

---

## 4. Feed Management — フィードのライフサイクル管理ができない

### Why

フィードを追加した後の運用手段が足りない。間違って追加したフィードが消せない、壊れたフィードのリカバリ手段がない、大量の記事を効率的に処理できない。

### What

- **フィードの削除ができない**: `add_feed` と `disable_feed` はあるが `remove_feed` がない。ゾンビフィードが残り続ける
- **エラーリカバリ手段がない**: HTTP 404 で止まったフィードの URL 更新や手動リトライができない
- **bulk 操作がない**: 「このフィードの記事を全部既読にする」が1記事ずつ。mark_as_read が単体操作のみ
- **状態管理が貧弱**: read/unread と bookmark/like だけ。「後で読む」「読みかけ」のような読書ワークフローに合わない
