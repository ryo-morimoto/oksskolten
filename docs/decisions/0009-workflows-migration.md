---
status: accepted
date: 2026-03-22
decision-makers: ryo-morimoto
supersedes: ADR-0003 (two-stage-queue-pipeline)
---

# Queue → Cloudflare Workflows 移行

## Context and Problem Statement

P0ではCron Trigger → Queue 2段階パイプラインでRSS取得・記事保存を実現した（ADR-0003）。
P1でkuromoji Container呼び出し・FTS5トークナイズ・trigram辞書蓄積が加わり、パイプラインが5ステップに拡大する。

Queue consumerの30秒タイムアウト内に全ステップを完了する必要があり、Container cold startを考慮すると制約が厳しい。
また、Queueベースではステップごとのリトライ・可観測性が得られない。

## Decision Drivers

- ステップごとのリトライと可観測性（Workflow Visualizer）
- Container呼び出しの待ち時間をQueue timeout制約なしに吸収
- Cloudflare公式の推奨（「順番にやる処理はWorkflows」）
- 冪等性の構造的保証

## Considered Options

1. 既存Queue + kuromojiステップ追加
2. Cloudflare Workflows移行
3. Queue維持 + 将来Workflows

## Decision Outcome

**Option 2: Cloudflare Workflows移行**

### Consequences

- Good: ステップごとリトライ・可観測性・CF公式推奨
- Good: Deterministic instance IDで重複起動防止
- Good: 各ステップの冪等性を構造的に強制（INSERT OR IGNORE, WHERE IS NULL）
- Bad: GA後の不安定性リスク（2025年中盤にstuck instances報告あり、2026年以降は改善傾向）
- Bad: Queue構成からの書き換えコスト（P1スコープ膨張）

### Risks

Workflows GA (2025-04) 以降も一部の不安定さが報告されている。
受容済み: 可観測性向上のメリットがリスクを上回ると判断。

## Implementation

- `ArticlePipelineWorkflow`: fetch_rss → dedup_and_save → extract_content → tokenize_query → tokenize_{id} × N → build_trigram → update_feed_metadata
- `startFeedWorkflows`: Cron → フィードごとにWorkflow instance作成（deterministic ID: `feed-{id}-{cronTimestamp}`）
- FEED_QUEUE producer/consumer設定を削除、`process-feed.ts` 削除
- **Container (DO) 呼び出しは1記事1ステップに分離する** — 1つの `step.do` 内で複数のDO間通信をするとデッドロックする（Workflows自体がDOベースのため）
