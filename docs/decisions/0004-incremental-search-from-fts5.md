---
status: "accepted"
date: 2026-03-22
decision-makers: ryo-morimoto
---

# Build search incrementally starting from D1 FTS5

## Context and Problem Statement

Fork元のMeilisearchをCloudflareエコシステムで何に置き換えるか。キーワード検索・タイポ補正・セマンティック検索の3層をどう段階的に構築するか。

## Decision Drivers

* P0で検索なしでも回る（Inboxは時系列表示）
* 各段階が独立して価値を持つこと
* FTS5スキーマは後から変更せずに層を追加できること

## Considered Options

* 3層同時構築（FTS5 + trigram辞書 + Vectorize + RRF）
* 2層（FTS5 + Vectorize、trigramなし）
* FTS5から段階的に追加

## Decision Outcome

Chosen option: "FTS5から段階的に追加", because 各段階が独立して価値を持ち、FTS5スキーマ変更なしで層を追加できる。

ロードマップ:
- P0: `title_tokens` / `full_text_tokens` 列をスキーマに準備（空） ✅
- P1: kuromoji + FTS5 + trigram辞書（キーワード検索 + タイポ補正） ✅
- P2: Vectorize + PLaMo追加（セマンティック検索）

### Consequences

* Good, because P0で検索機能なしでもパイプラインが動く
* Good, because FTS5のtokenカラムはP0で準備済み、後から全記事再インデックス不要
* Bad, because P1までキーワード検索が使えない
