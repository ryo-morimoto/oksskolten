---
status: accepted
date: 2026-03-22
decision-makers: ryo-morimoto
---

# Use bge-m3 as embedding model for semantic search

## Context and Problem Statement

P2でVectorizeセマンティック検索を追加するにあたり、Workers AI上のembeddingモデルを選定する必要がある。RSSリーダーとして日本語記事と英語記事の両方を扱う。

## Decision Drivers

- 日本語・英語の両方で検索品質が実用的であること
- Vectorize の次元上限 (1536) 以内
- Workers AI 上で利用可能
- 単一モデル・単一indexで運用できるシンプルさ

## Considered Options

1. PLaMo-Embedding-1B（日本語最強、2048 dim）
2. bge-m3（CJK最適化 multilingual、1024 dim）
3. Qwen3-Embedding-0.6B（multilingual、~1024 dim）
4. PLaMo(JP) + bge-large-en(EN) の dual model

## Decision Outcome

**Option 2: bge-m3**

### Consequences

- Good: 1024 dim → Vectorize 上限内、$0.012/M tokens（最安）
- Good: CJK最適化（中日英トリリンガル）— 汎用 multilingual より日本語に強い
- Good: クロスリンガル検索可能（英語で検索 → 日本語記事がヒット）
- Good: 単一 index・単一パイプライン・言語検知不要
- Bad: 日本語 retrieval 品質は PLaMo (JMTEB ~80) より劣る (~70-73 推定)
- Neutral: RSS記事のセマンティック検索用途では品質差は体感しにくい

### Why not PLaMo-Embedding-1B

PLaMo は JMTEB retrieval 79.94 で日本語最強だが、出力が **2048 次元** で Vectorize 上限 1536 を超過する。Workers AI エンドポイントでの truncation サポートが未確認のため不可。品質不足が判明した場合に再調査する。
