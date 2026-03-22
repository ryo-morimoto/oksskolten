---
status: "accepted"
date: 2026-03-22
decision-makers: ryo-morimoto
---

# Use Defuddle + linkedom for content extraction in Workers

## Context and Problem Statement

Fork元のコンテンツ抽出パイプライン（jsdom + Readability + 500パターンcleaner + Turndown）をCloudflare Workers上でどう実現するか。

## Decision Drivers

* Workers のメモリ上限128MBで動作すること
* 外部サービス依存を最小化
* Fork元の500パターンnoise removalのメンテコストを回避

## Considered Options

* Worker内完結（linkedom + Defuddle）
* Worker + Browser Rendering APIフォールバック
* Container内でjsdom + Defuddle

## Decision Outcome

Chosen option: "Worker内完結", because Defuddleはlinkedomを推奨DOMパーサーとして設計しており、Workers（`nodejs_compat`）で動作実証済み。

Fork元の500パターンnoise removalは捨てる。Defuddleが内包するノイズ除去に委ね、問題ベースで対応する。

### Consequences

* Good, because 外部依存なし、レイテンシ最小（100-200ms/記事）
* Good, because Defuddleが内蔵するノイズ除去・Markdown変換で6コンポーネント→1に短縮
* Bad, because 巨大ページ（>5MB HTML）でOOMリスクあり
* Bad, because JS-renderedサイトの記事は空になる（RSS content:encodedフォールバックのみ）

### Confirmation

* P0本番でCloudflare Blog/Zenn/CF Changelogの記事を正常抽出（full_text 14K chars）
* JS-renderedサイトが必要になったらBrowser Rendering API追加で対応

## More Information

See [ADR-0006](0006-defuddle-esm-prebundle.md) for the CJS compatibility workaround.
