---
status: "accepted"
date: 2026-03-22
decision-makers: ryo-morimoto
---

# Use MADR 4.0 format in docs/decisions/ for new ADRs

## Context and Problem Statement

Fork元に `docs/adr/` ディレクトリがあり、独自フォーマットでADRが記録されている（001, 002）。CF版で新たな設計判断を記録する際、どのフォーマット・ディレクトリを使うか。

## Decision Drivers

* Fork元の `docs/adr/` との同期を避けたい（upstream mergeで競合しない）
* 1つの意思決定につき1つのファイル（旧003は実行計画と混在していた）
* 業界標準のフォーマットに従いたい

## Considered Options

* Fork元の `docs/adr/` に独自フォーマットで追記
* `docs/decisions/` に MADR 4.0 形式で新設

## Decision Outcome

Chosen option: "`docs/decisions/` に MADR 4.0", because Fork元との同期が不要になり、1決定1ファイルの粒度が強制される。

- `docs/adr/` — Fork元由来（001, 002）。触らない
- `docs/decisions/` — CF版の新規ADR。MADR 4.0テンプレート
- ファイル命名: `NNNN-title-with-dashes.md`（4桁連番）

### Consequences

* Good, because upstream merge時に `docs/adr/` の競合が起きない
* Good, because MADR 4.0の構造化されたセクション（Context, Options, Outcome, Consequences）で判断根拠が明確になる
* Neutral, because Fork元の001, 002は旧フォーマットのまま残る（移行しない）
