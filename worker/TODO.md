# TODO

## 1. Search & Discovery — 検索で目的の記事にたどり着けない

### Why

3000+記事の中から概念的に関連する記事を見つける手段が事実上ない。"product issue why what problem definition" で検索して Cloudflare Custom Regions の記事が返ってくる。5回クエリを変えても目的の記事に到達できなかった。フィードリーダーの存在意義に関わる。

### What

- **意味的検索の精度が低い**: FTS5 + Vectorize のハイブリッド検索が実装されているが、キーワード部分一致レベルの結果しか返さない。Vectorize 側が実質機能していない可能性がある
- **検索とフィード絞り込みが併用できない**: `search_articles` に `feed_id` がない。「Will Larsonの記事からproduct thinkingを探す」が一発で出せない
- **corrections がノイズ**: "product issue" に対して "productionizing" が返る。スペルミス修正ではなく無関係な候補
- **トピックベースの探索手段がゼロ**: 「最近フィード横断で多く議論されているテーマは？」に答える機能がない
- **similar_articles が鶏卵問題**: 起点となる記事IDが必要だが、その記事を検索で見つけられない

---

## 2. Scoring & Recommendation — レコメンドが機能していない

### Why

全記事 `score: 0`。get_recommended が何を返しても根拠がない。検索も壊れているため、数千記事の中から「今読むべきもの」を発見する手段が完全にゼロ。

### What

- **全記事 score: 0**: interest score の算出ロジックが engagement データ（read/like/bookmark）に依存するが、利用データがゼロまたは蓄積されていない
- **quality_score が活用されていない**: EnrichWorkflow で計算されているが、レコメンド以外の表面（検索結果の並び順、フィード一覧）に露出していない
- **コールドスタート問題**: engagement がない状態でもそれなりの推薦ができる仕組みが必要

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
