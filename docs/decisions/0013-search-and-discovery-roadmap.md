---
status: proposed
date: 2026-03-23
decision-makers: ryo-morimoto
---

# Search & Discovery の段階的改善

## Context and Problem Statement

3000+記事を蓄積しているが、目的の記事にたどり着く手段がほぼ機能していない。

- **検索精度が致命的に低い**: "product issue why what problem definition" で Cloudflare Custom Regions の記事が返る。5回クエリを変えても概念的に関連する記事に到達できない
- **レコメンドが死んでいる**: 全記事 score: 0。発見手段がゼロ
- **フィード絞り込みができない**: 「Will Larsonの記事から product thinking を探す」が一発で出せない
- **zero-query discovery がない**: 「何を検索すべきかわからない」問題に答える機能がない

データの ingest は動いているが、discovery / retrieval / curation の層が全部薄いか壊れている。

## Root Cause Analysis

コードを調査した結果、以下の根本原因を特定した。

### 1. Embedding 入力が貧弱

`embedArticles()` が Vectorize に渡すテキストは `title + excerpt`（約200文字）のみ。`full_text` は extract_content ステップで取得済みだが embedding に使われていない。bge-m3 は 8192 トークン対応なのに、ほぼ空の入力でセマンティック検索させている。

### 2. Trigram corrections のマルチワード未対応

`hybridSearch()` がクエリ全体（例: "product issue"）を `term_dictionary` で1語として完全一致検索する。辞書に存在しないので常に trigram 補正が発火し、無関係な候補（"productionizing"）を返す。

### 3. 検索の絞り込み不足

`hybridSearch()` と `search_articles` MCP ツールに `feed_id` パラメータがない。Vectorize metadata には `feed_id` を保存済みだが、検索時にフィルタとして使っていない。

## Decision Drivers

- 検索が「壊れている」を「使える」にするのが最優先
- 検索の精度向上だけでは不十分 — 検索に頼らない発見手段が必要
- Cloudflare のプリミティブ（Workers AI, Vectorize, D1）で実現可能であること
- シングルユーザーシステムなので協調フィルタリングは不可。コンテンツベースが唯一の選択肢

## Ideal End State

1. **記事に構造化されたトピックタグがある** — LLM 抽出、ブラウズ可能
2. **同じストーリーが束ねられている** — 複数フィードが同じ話題を扱っていたら集約
3. **「今日何が起きた」が zero-query で出る** — トピック別代表記事 + トレンド
4. **検索がフィード・トピックで絞り込める** — 複合条件の検索が一発
5. **検索の semantic 精度が実用レベル** — 概念的な検索が機能する

## Known Edge Cases (not solving now)

- トピックタグの粒度管理（"Kubernetes" vs "container orchestration" の正規化）
- ストーリーグループの時間窓（1週間前の記事と今日の記事は同じストーリーか？）
- 日本語記事のトピック抽出品質（Workers AI のモデル依存）
- タグの retroactive 適用（既存 3000 記事への backfill コスト）

## Steps

### Step 1: 検索の基盤修正（Now）

検索が「壊れている」を「使える」にする。happy path のみ。

**1-a. Embedding 入力を full_text に拡張**

`embedArticles()` の SELECT に `full_text` を追加し、embedding テキストを `title + full_text`（8000 トークンで truncate）に変更する。既存記事は `embedded_at` を NULL にリセットして re-embed する migration を用意する。

**1-b. Trigram corrections のマルチワード対応**

`hybridSearch()` のクエリ補正ロジックを変更する。クエリを単語分割し、各単語を `term_dictionary` で照合する。辞書に存在しない単語だけ trigram 候補を検索する。

**1-c. feed_id フィルタ追加**

`hybridSearch()` に `feedId?: number` パラメータを追加する。FTS5 クエリに `WHERE a.feed_id = ?` を追加し、Vectorize クエリに `filter: { feed_id }` を追加する。`search_articles` MCP ツールと REST API にも `feed_id` を追加する。

### Step 2: トピックタグ抽出（When 検索が動く）

EnrichWorkflow に Workers AI によるトピックタグ抽出ステップを追加する。記事ごとに 3-5 個のトピックタグを抽出し、`article_topics` テーブルに保存する。これにより検索のトピック絞り込み、ブラウズ、トレンド検出の土台ができる。

### Step 3: トレンド検出 + Explore フィード（When タグがある）

トピックタグの出現頻度の変化率を計算し、トレンドを検出する。純粋な SQL カウント。`get_trending_topics` と `get_explore_feed` MCP ツールを追加し、zero-query discovery を実現する。

### Step 4: ストーリーグルーピング（When 記事が増える）

IngestWorkflow で新規記事の embedding を最近 48 時間の記事と比較し、cosine similarity > 0.80 の記事を同一ストーリーとしてグルーピングする。重複排除。フィード数が増えたときに効く。

→ **Ideal**: 検索に頼らず、開いた瞬間に「今読むべきもの」が見える

## Research Findings

業界のベストプラクティス調査から得た判断材料。

### 筋が良いパターン

- **LLM でトピックタグ抽出**: Feedly Leo の成功パターン。教師なしクラスタリング（BERTopic/LDA）よりラベルが意味的で、ユーザーがアクションできる
- **ストーリーグルーピング**: embedding cosine similarity による重複検出。Nuzzel/Apple News が採用
- **トレンド検出**: トピック出現頻度の変化率。ML 不要、純粋なカウント
- **セレンディピティ注入**: 高品質だが低エンゲージメントのフィードから記事を混ぜる。フィルターバブル対策

### 避けるべきアンチパターン

- **教師なしクラスタリング主軸**: ラベル不明、日次で変動、Workers で実行不能
- **Retrieval 修正前の Reranker 導入**: 3000 記事規模では取得品質の問題
- **エンゲージメント最適化への過傾斜**: シングルユーザーでフィルターバブル即発生（Artifact の失敗）
- **スコアリング関数の複雑化**: `quality x interest x recency` で十分。デバッグ不能になる
