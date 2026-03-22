---
status: "accepted"
date: 2026-03-22
decision-makers: ryo-morimoto
---

# Split modules only at library boundaries and deep module boundaries

## Context and Problem Statement

P0完了後のリファクタリングで、`process-feed.ts`（228 LOC / 177行関数）の分割を検討した。コードの行数や関数の長さだけを理由にモジュールを分割すべきか。

## Decision Drivers

* 「長い関数 = 悪い」という機械的なルールを避けたい
* 分割が将来の変更を容易にする場合のみ分割する
* 浅いラッパー（thin wrapper）の増殖を防ぐ

## Considered Options

* 行数ベースで機械的に分割（長い関数は分割すべき）
* 目的ベースで分割（切替可能性 or 深いモジュールの基準）

## Decision Outcome

Chosen option: "目的ベースで分割", because 分割は将来の変更容易性のためにのみ行う。行数は分割の理由にならない。

モジュール分割の基準は2つだけ:

1. **将来別の実装に切り替える可能性がある部分** — ライブラリ依存を隠蔽するインターフェースとして切り出す。呼び出し元はライブラリの存在を知らない。
2. **Deep module** — 複雑な実装を単純なインターフェースの裏に隠す価値がある部分。インターフェースの面積に対して実装の深さが大きい。

分割しないもの:

- **オーケストレーションコード** — 手順を上から順に呼ぶだけのコード。長くても読めば順序がわかる。分割すると実行順序の把握にファイル間ジャンプが必要になり、かえって読みにくくなる。
- **浅いユーティリティ** — 5行のパターン（バッチチャンキング等）を関数に切り出しても、呼び出し元の意図が曖昧になるだけ。

### Consequences

* Good, because 不要なファイル・関数の増殖を防ぐ
* Good, because 各モジュールの存在理由が明確（「なぜこのファイルがあるか」に答えられる）
* Bad, because 行数だけ見ると「長すぎる」と感じるコードを許容する必要がある
* Neutral, because コードレビューで「分割すべき」と指摘された場合、この基準で反論できる

### Confirmation

P0のモジュール境界を本基準で検証した結果:

| モジュール | 基準 | 判定 |
|---|---|---|
| `rss-parser.ts` | ライブラリ境界（feedsmith/fast-xml-parser） | ✓ 正しく分離 |
| `extract-content.ts` | ライブラリ境界（Defuddle） + Deep module | ✓ 正しく分離 |
| `schedule.ts` | Deep module（3シグナル合成） | ✓ 正しく分離 |
| `url-cleaner.ts` | ライブラリ境界（パラメータセット変更可能） | ✓ 正しく分離 |
| `process-feed.ts` | オーケストレーション | ✓ 分割不要 |

## More Information

John Ousterhout, *A Philosophy of Software Design* の "deep module" 概念に基づく。浅いモジュール（インターフェースの複雑さ ≥ 実装の複雑さ）は複雑さを減らさず、増やす。
