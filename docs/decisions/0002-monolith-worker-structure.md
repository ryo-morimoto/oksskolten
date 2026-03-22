---
status: "accepted"
date: 2026-03-22
decision-makers: ryo-morimoto
---

# Use Monolith Worker for project structure

## Context and Problem Statement

Oksskolten CFのWorkerコードをどう構成するか。API、Queue consumer、Cron Triggerを1つのWorkerに集約するか、機能別に分離するか。

## Decision Drivers

* 初速を最優先（自分のツール、OSSではない）
* `wrangler deploy` 1コマンドでデプロイしたい
* コード共有が自然にできること
* 将来の分離が可能であること

## Considered Options

* Monolith Worker（1つのWorkerに全集約）
* Multi-Worker（api / pipeline / container の3デプロイ）
* Service Bindings（Multi-Worker + V8内部RPC）

## Decision Outcome

Chosen option: "Monolith Worker", because 初速が最も速く、分離は後からできる。

Monolith → Multi-Workerへの移行はHonoルーティングを別エントリポイントに切り出すだけで可能。バンドルサイズ10MB上限に達するまでは分離の必要がない。

### Consequences

* Good, because デプロイが1コマンドで完結する
* Good, because コード共有に追加設定（monorepo/workspace）が不要
* Good, because ローカル開発が `wrangler dev` 1つで済む
* Bad, because バンドルサイズが10MB（圧縮後）を超えたら分離が必要
* Neutral, because ContainerはMonolith構成でも別デプロイが必須

### Confirmation

* P0完了時点のバンドルサイズ: 1716 KiB / gzip 381 KiB（上限の3.8%）
* バンドルサイズが5MBを超えたら本ADRを再評価する

## More Information

P0実装で `worker/` ディレクトリに配置。最終的に `server/`（Fork元Node.js版）を置き換え予定。
