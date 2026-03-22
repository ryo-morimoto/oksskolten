---
status: "deprecated"
superseded-by: ADR-0009 (workflows-migration)
date: 2026-03-22
decision-makers: ryo-morimoto
---

# Use 2-stage Queue pipeline for feed processing

## Context and Problem Statement

RSSフィード取得パイプラインをCloudflare Queuesでどう分割するか。Cron Triggerの壁時間30秒以内に各ステップを収める必要がある。

## Decision Drivers

* 各ステップが30秒の壁時間制限に収まること
* シンプルさ（Queue数・デバッグ容易性）
* 記事がD1に入った時点でInboxに表示可能であること

## Considered Options

* 4段階（フィードリスト → fetch+parse → Defuddle → batch index）
* 3段階（フィードリスト → fetch+parse+Defuddle → batch index）
* 2段階（フィードリスト → fetch+parse+Defuddle+D1保存 / batch index）

## Decision Outcome

Chosen option: "2段階", because Defuddleは決定的関数であり分離にリトライ上の意味がない。

Stage 1: Cron → フィード一覧 → Queue enqueue
Stage 2: Queue consumer → fetch + parse + dedup + D1保存 + Defuddle抽出

### Consequences

* Good, because Queue数が最小（2つ）でデバッグが容易
* Good, because 記事メタデータがD1に入った時点で閲覧可能
* Good, because fetch+Defuddleは1記事あたり1-3秒で30秒に余裕で収まる
* Bad, because Defuddleが失敗しても記事単位でリトライできない（fetch全体がリトライ対象）
* Neutral, because P1のbatch index（kuromoji + FTS5）は別Queueとして追加予定

### Confirmation

* P0本番稼働で3フィード/762記事を正常取得。各Queue消費は30秒以内に完了。
