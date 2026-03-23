# Engineering Harness

システムの健全性を人間の規律ではなく構造で強制する仕組みの総体。
テストはその一部品に過ぎない。型システムからデプロイ安全性まで、コードが書かれてから本番で動き続けるまでの全ライフサイクルを覆う。

設計原理は一つ：**正しいことを簡単に、間違ったことを困難にする。**

## 根拠

- Ousterhout, *A Philosophy of Software Design* — 複雑性は小さな判断の蓄積で致命的になる
- Winters et al., *Software Engineering at Google* — 人間はルールの一貫した適用が構造的に苦手。自動化せよ
- Forsgren, Humble, Kim, *Accelerate* — 速度と安定性はトレードオフではない。両方を同時に最適化せよ
- Nygard, *Release It!* — 統合点がシステム障害の最大原因。安定性パターンで構造的に制御せよ
- Johnsson, Deogun, Sawano, *Secure by Design* — セキュリティは設計の性質であるべき。後付けのチェックではない
- Ford, Parsons, Kua, *Building Evolutionary Architectures* — ドキュメント上の設計判断は腐る。自動テストにエンコードされた設計判断は残る

---

## 強制レベル (Enforcement Level)

すべてのハーネス要素は、この 4 段階のどこに位置するかで評価する。上に押し上げるほど強い。

| Level | フィードバック遅延 | 回避難易度 | 性質 |
|---|---|---|---|
| **L0: 不可能** | ミリ秒 (IDE / コンパイラ) | 型を変えない限り不可能 | 構造的に違反が存在できない |
| **L1: 自動拒否** | 秒〜分 (CI) | ルール無効化が必要 | 違反はマージできない |
| **L2: 自動検出** | 分〜時間 (post-merge) | PR で可視だが強制力は弱い | 違反は検出されるが通過しうる |
| **L3: 人間の規律** | 日〜週 (レビュー) | 容易に見落とす | 慣習に依存、最も脆弱 |

ハーネス設計の目標：すべての保護を L3 から L0 方向に押し上げること。

---

## 5 層アーキテクチャ

```
┌──────────────────────────────────────────────────────────────┐
│  Layer A: 静的強制 (Static Enforcement)                       │
│  コードが走る前に違反を潰す                                      │
├──────────────────────────────────────────────────────────────┤
│  Layer B: 動的強制 (Dynamic Enforcement)                      │
│  コードが走る時に違反を検出する                                   │
├──────────────────────────────────────────────────────────────┤
│  Layer C: プロセス強制 (Process Enforcement)                   │
│  コードが出荷される時に違反を止める                                │
├──────────────────────────────────────────────────────────────┤
│  Layer D: 構造強制 (Architectural Enforcement)                │
│  構造の健全性を経時的に保証する                                   │
├──────────────────────────────────────────────────────────────┤
│  Layer E: 衛生強制 (Hygiene Enforcement)                      │
│  腐敗の蓄積を防ぐ                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Layer A: 静的強制

コードが実行される前に違反を潰す。最もレバレッジが高い層。

### A1. 型システム (L0)

型システムは最も強力な強制装置。違反がコンパイルできなければ本番に到達しない。

原則: **Parse, Don't Validate** — 境界で `unknown` を型付きデータに変換する。内部では再検証しない。

| 技法 | 何を防ぐか |
|---|---|
| Branded types | 型の取り違え (ID 混同、injection) |
| Sum types (discriminated union) | 不正な状態遷移、未処理の分岐 |
| exhaustive match | ハンドルされないケース |
| `readonly` / `Readonly<T>` | 意図しない変更 |
| `noUncheckedIndexedAccess` | 配列 / オブジェクトの未定義アクセス |

tsconfig.json の最低限の強制構成:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

Branded types による injection 防止:

```typescript
type SafeHtml = string & { readonly __brand: unique symbol }
type RawUserInput = string & { readonly __brand: unique symbol }

// parse 関数が唯一のコンストラクタ — バリデーションは必須
function sanitizeHtml(raw: RawUserInput): SafeHtml { /* ... */ }

// SafeHtml 以外は compile error
function renderToPage(html: SafeHtml): void { /* ... */ }
```

Sum types による状態マシン保護:

```typescript
type User =
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; token: AuthToken; permissions: ReadonlySet<Permission> }
  | { kind: 'admin'; token: AuthToken; permissions: ReadonlySet<Permission> }

// コンパイラが全分岐の網羅を保証。新しい variant 追加時に未処理箇所が compile error
```

### A2. Lint / Import 境界 (L1)

Lint はスタイルではない。設計判断をルールとしてエンコードする装置。

| 目的 | 手段 |
|---|---|
| モジュール境界の強制 | `eslint-plugin-boundaries` / `no-restricted-imports` |
| 循環依存の禁止 | `dependency-cruiser` の `no-circular` ルール |
| レイヤー違反の禁止 | `dependency-cruiser` のカスタム forbidden ルール |
| 非構造化ログの禁止 | `no-console` + 型付き Logger への強制 |

### A3. Dead code / 依存分析 (L1)

Knip — 未使用のファイル、export、依存を検出。CI で実行し、未使用コードの蓄積をブロック。

### A4. セキュリティスキャン (L1)

| 種別 | 何を検出 | 多層防御 |
|---|---|---|
| Secret scanning (diff) | コミット差分内の秘密情報 | Gitleaks pre-commit (ローカル) |
| Secret scanning (全体) | ファイル全体の秘密情報パターン | secretlint (CI + ローカル) |
| SCA | 脆弱な依存 | `npm audit` + Dependabot |

---

## Layer B: 動的強制

コードが実行される時に違反を検出する。

### B1. テストハーネス (L1)

テストハーネスはテストコードと SUT (System Under Test) の間を仲介するモジュール。

**単一責任**: テストケースに決定論的・隔離された SUT 実行環境を提供する。

**4 フェーズテスト (Meszaros):**

```
Phase 1: SETUP    — ハーネスの責任 (環境構築)
Phase 2: EXERCISE — テストコードの責任 (SUT 呼び出し)
Phase 3: VERIFY   — テストコード + フレームワーク (アサーション)
Phase 4: TEARDOWN — ハーネスの責任 (環境破棄)
```

**ハーネスはモジュールとして設計する:**

```
test/
  harness/                  <- public API boundary
    index.ts                <- re-exports only
    context.ts              <- テストコンテキストファクトリ
    lifecycle.ts            <- beforeAll/afterAll/beforeEach hooks
    db.ts                   <- seed, clean, migrate
    http.ts                 <- request builder
    fixtures/               <- データファクトリ
      article.ts
      feed.ts
    doubles/                <- fakes, stubs
  unit/
  integration/
  e2e/
  architecture/             <- フィットネス関数 (Layer D)
```

テストコードは `harness/index.ts` からのみ import する。ハーネス内部を直接参照しない。

**5 つの保証 (Harness Properties):**

| 性質 | 定義 | 根拠 |
|---|---|---|
| Determinism | 同じテスト、同じ入力、常に同じ結果 | Fowler: "Non-deterministic tests are useless" |
| Isolation | テスト間で状態が漏れない | SWE@Google: hermeticity principle |
| Speed | 高速フィードバック (fidelity を犠牲にしない) | SWE@Google: test size (small/medium/large) |
| Fidelity | テストが本番の挙動を反映する | SWE@Google Ch.14: fidelity と hermeticity は直接的に緊張関係にある |
| Maintainability | ハーネスコードは変更しやすい | SWE@Google Ch.12: DAMP over DRY in tests |

**Test Doubles の優先順位:**

Real implementation > Fake > Stub > Mock

Mock は最後の手段。interaction testing を避け、state testing を優先する。

> "When mocking frameworks first came into use at Google, they seemed like a hammer fit for every nail... we suffered greatly." — SWE@Google Ch.13

**テスト配分 (Testing Trophy):**

| レイヤー | 比率 | 実行環境 |
|---|---|---|
| Static analysis | 基盤 | IDE / CI (tsc + eslint) |
| Unit tests | ~15% | workerd (純粋関数) |
| Integration tests | ~70% | workerd + Miniflare D1 |
| E2E tests | ~15% | Node.js → remote HTTP |

### B2. 境界バリデーション (L0)

Hono ルートの入口で Zod スキーマを適用。バリデーション通過後は internal コードが再検証しない。

```typescript
const CreateFeed = z.object({
  url: z.string().url(),
  rss_url: z.string().url(),
  name: z.string().min(1).max(200),
})

app.post('/feeds', zValidator('json', CreateFeed), async (c) => {
  const input = c.req.valid('json') // 型安全、検証済み
})
```

### B3. 安定性パターン (Runtime L1)

> "Integration points are the number-one killer of systems." — Release It!

| パターン | 強制内容 | oksskolten 適用 |
|---|---|---|
| Timeout | 全外部呼び出しに上限 | Container = 2min, RSS fetch = 15s |
| Circuit Breaker | 連続失敗で自動遮断 | Container cold start 失敗時 |
| Bulkhead | 障害ドメインの隔離 | Workflow-per-feed |
| Fail Fast | 成功不可能なリクエストの即時拒否 | 無効な feed URL の早期リジェクト |
| Steady State | 人手なしで既知良好状態に復帰 | Cron + idempotent workflow ID |

### B4. 可観測性 (L1-L2)

可観測性はロギングツールではない。システム自身が自己の振る舞いを可視化する性質。

> "A system is observable to the extent that you can understand new internal system states from its outputs without shipping new code." — Observability Engineering

**3 層設計:**

```
Layer 1: 型付き Logger  — コンパイル時に非構造化ログを拒否 (L0)
Layer 2: 境界計装      — 全統合点が自動でイベント発行 (L1)
Layer 3: SLO + Error Budget — 信頼性の契約を数値で強制 (L2)
```

**型付き Logger:**

```typescript
interface LogEvent {
  readonly event: string           // dot-separated event name
  readonly level: 'debug' | 'info' | 'warn' | 'error'
  readonly correlationId: string   // workflow instance ID or request ID
  readonly [key: string]: unknown  // high-cardinality fields
}
```

`console.log(string)` は lint で禁止。全ログは型付き Logger 経由。

**境界計装:**

全統合点 (D1, Vectorize, Container, external HTTP) をラッパーで包み、自動でイベント発行。開発者は opt-in しない — opt-out できない。

**SLO (Google SRE Book):**

| SLI | SLO | Error Budget Policy |
|---|---|---|
| パイプライン成功率 | 99.5% / 30 日 | 枯渇 → 機能開発停止、信頼性改善 |
| 検索レイテンシ p95 | < 500ms | 50% 消費 → 調査開始 |
| API 可用性 | 99.9% / 30 日 | 枯渇 → デプロイ凍結 |

**アラート設計 (SRE Workbook):**

- Page (人を起こす): SLO バーンレートの急上昇のみ
- Ticket: 注意は必要だが緊急ではない
- Log: それ以外すべて

個別エラーでアラートしない。バーンレートで判断する。

---

## Layer C: プロセス強制

コードが出荷される時に違反を止める。

### C1. CI/CD パイプライン (L1)

パイプラインは他の全レイヤーを直列化するオーケストレータ。

```
Presubmit (PR 時、分単位)          Post-submit (merge 後、時間単位)
┌──────────────────────────┐      ┌────────────────────────────┐
│ tsc --noEmit             │      │ Integration tests (full)   │
│ eslint                   │      │ E2E tests                  │
│ dependency-cruiser       │      │ Coupling metrics           │
│ knip                     │      │ Mutation testing           │
│ gitleaks                 │      │ DAST                       │
│ Unit + fast integration  │      │ Performance benchmarks     │
│ Fitness functions        │      │                            │
└──────────────────────────┘      └────────────────────────────┘
```

原則: presubmit のコストは保護価値に比例すべき。5 分超の presubmit は速度を殺す。

### C2. デプロイ安全性 (L1-L2)

| 機構 | 目的 |
|---|---|
| Feature flags | デプロイとリリースの分離 |
| Canary check | デプロイ後 5 分以内に「壊れていないか」を自動判定 |
| 自動ロールバック | エラーレート閾値超過で人手なし復帰 |

### C3. コードレビュー (L3 — 設計判断のみ)

> "Automated tools catch bugs. Humans evaluate design." — SWE@Google Ch.9

レビューで見るべきもの:
- この抽象化は正しいか？
- モジュール境界は適切か？
- この変更は全体の複雑性を増やすか減らすか？

レビューで見るべきでないもの (自動化すべき):
- フォーマット、命名、import 順序 → Lint
- テストの存在 → CI gate
- セキュリティ脆弱性 → SAST

---

## Layer D: 構造強制

構造の健全性を経時的に保証する。最も稀で最も価値の高い層。

### D1. モジュール境界 (L1)

dependency-cruiser でレイヤー違反と循環依存を CI で拒否。

```javascript
// .dependency-cruiser.cjs
{
  forbidden: [
    { name: 'no-circular', from: {}, to: { circular: true } },
    { name: 'domain-no-infra',
      from: { path: '^src/domain' },
      to: { path: '^src/infrastructure' } },
  ]
}
```

### D2. Deep Module 検証 (L2)

> "A deep module has a small interface hiding a large implementation." — Ousterhout

計測:
- Interface size: export されるシンボル数
- Implementation size: インターフェース背後のコード行数
- Ratio: implementation / interface — 低下は shallowing (浅化) のシグナル

### D3. API 安定性 (L1)

API Extractor で公開 API の `.api.md` レポートを生成・コミット。PR 毎に diff。意図しない破壊的変更をブロック。

### D4. フィットネス関数 (L1-L2)

> "Architectural decisions that exist only in documentation decay. Architectural decisions encoded as automated tests persist." — Building Evolutionary Architectures

```typescript
// test/architecture/fitness.test.ts
describe('Architectural Fitness Functions', () => {
  it('no circular dependencies', () => { /* depcruise */ })
  it('domain layer has zero external deps', () => { /* depcruise */ })
  it('no module exports > 15 symbols', () => { /* knip */ })
  it('feature modules are independently deletable', () => {
    // cross-feature import count == 0
  })
})
```

| 種類 | 実行タイミング |
|---|---|
| Atomic / Triggered | CI on every PR (高速、マージをブロック) |
| Holistic / Triggered | CI post-merge or staging deploy |
| Atomic / Continuous | Weekly cron (漸進的ドリフトの検出) |
| Holistic / Continuous | Monitoring + alerting (ランタイム特性) |

---

## Layer E: 衛生強制

腐敗の蓄積を防ぐ。

### E1. Dead code 検出 (L1)

Knip — 未使用ファイル、未使用 export、未使用依存を CI で検出。蓄積をブロック。

### E2. 意味的重複 (L2-L3)

同じことを異なる方法で行うコード。テキスト上は異なるが意味は同じ。
完全自動化は困難。Knip の未使用 export 検出 + レビューで補完。

### E3. 偽の抽象化 (L2-L3)

構造だけ同じコードを統合してしまう問題。DRY の濫用。

> "duplication is far cheaper than the wrong abstraction" — Sandi Metz

検出ヒューリスティクス:
- 呼び出し元ごとに使うサブセットが異なるユーティリティモジュール
- 一箇所でしかインスタンス化されないジェネリック型
- 引数を透過するだけのラッパー関数

### E4. 依存鮮度 (L1)

Dependabot / Renovate + テストスイートパス → 自動マージ。失敗 → レビュー。

---

## 強制マトリクス

全脅威と全レベルの対応表。

| 脅威 / 違反 | L0 (不可能) | L1 (自動拒否) | L2 (自動検出) |
|---|---|---|---|
| Injection (SQL/XSS) | Branded types | Semgrep OWASP | DAST |
| 権限昇格 | Sum type user states | RBAC middleware tests | Pen test |
| 秘密情報漏洩 | — | Gitleaks pre-commit + secretlint CI | — |
| 脆弱な依存 | — | npm audit / Snyk | Scheduled SCA |
| 不正入力 | Zod at boundaries | Schema tests | DAST fuzzing |
| レイヤー違反 | — | dependency-cruiser | — |
| 循環依存 | — | dependency-cruiser | Graph viz |
| Dead code 蓄積 | — | Knip in CI | 定期レポート |
| API 破壊的変更 | — | API Extractor diff | Contract test |
| モジュール肥大 | — | Fitness: max exports | Ca/Ce メトリクス |
| 機能結合 | — | Cross-feature import check | Dep graph analysis |
| 偽の抽象化 | — | — | Review + Knip unused |
| 状態マシンバグ | Sum types + exhaustive | — | — |
| 非構造化ログ | 型付き Logger | no-console lint | Tail Worker 検証 |
| テスト品質劣化 | — | Coverage threshold ratchet | Mutation testing |
| フレイキーテスト | — | Quarantine + expiry | Flake rate tracking |

---

## ハーネス自体の設計原則

### 1. フィードバック horizon

すべての強制をできる限りミリ秒側に押す。型エラーにできるものは Lint にしない。Lint にできるものは CI にしない。

### 2. 摩擦予算 (Friction Budget)

すべてのゲートは `保護価値 / 開発者摩擦` で評価する。比率が低ければ削除。

- 5 分超の presubmit → 速度を殺す
- 10% 超の commits で発火する lint rule → 攻撃的すぎる
- 3 行超のボイラープレートが必要な型制約 → エルゴノミクス改善が必要

### 3. ハーネスの保守

ハーネス自体がコード。腐る。

- 不要になったルールは削除する (harness rot 防止)
- アーキテクチャ変更時に対応するフィットネス関数を同じ PR で更新
- ルール追加には rationale 必須。理由を言えないルールは削除候補

### 4. ハーネスの可観測性

| メトリクス | 意味 |
|---|---|
| Gate pass rate | 99.9% 通過するゲートは何も守っていない |
| Gate catch rate | 本番障害の何 % がゲートで防げたか |
| 開発者体感 | eslint-disable の頻度、CI 再実行頻度 |

---

## 反パターン

| 反パターン | 症状 | 原因 | 対処 |
|---|---|---|---|
| Over-enforcement | PR が CI 通過に 3 回以上必要 | 摩擦予算超過 | 保護/摩擦比で監査、低比率を除去 |
| Paper Tiger | ゲートはあるが `--no-verify` で回避 | 買収なき強制 | 全ゲートを hard fail 化。warning は除去 |
| Cargo Cult | 理由を言えないルールが存在 | 無批判コピー | rationale 必須ポリシー |
| Harness Rot | リネーム済みモジュールの旧名がルールに残る | set-and-forget | アーキ変更 PR にハーネス更新を含める |

---

## 具体化: oksskolten での採用判断

以下は各レイヤーの理論を oksskolten の現状に適用した具体的な判断。
各項目に「意図」「採用」「不採用（とその理由）」を明示する。

### 現状の強み（変えないもの）

| 既存要素 | 評価 | 判断 |
|---|---|---|
| tsconfig `strict: true` + `noUnusedLocals/Parameters` | L0 強制が効いている | 維持。追加フラグを足す |
| `@typescript-eslint/no-floating-promises: 'error'` | async 安全性の最重要ルール | 維持 |
| Miniflare in-memory D1 (テストで実物使用) | Real > Fake > Mock の原則に合致 | 維持。mock に退行しない |
| テスト配分 (unit 15% / integration 70% / E2E 15%) | Testing Trophy に合致 | 維持 |
| モジュール構造 (循環依存ゼロ、DAG) | 清潔。Layer D で自動強制を追加 | 維持 + 強制追加 |
| Workflow-per-feed (Bulkhead) | 障害隔離が構造的 | 維持 |
| Timeout 全ステップ設定済み | 全外部呼び出しにタイムアウトあり | 維持 |
| Feed error backoff (exponential, max 4h) | Steady State パターン | 維持 |

---

### Layer A 具体化: 静的強制

#### A1. tsconfig 追加フラグ

**意図**: 現在の strict に加え、配列アクセスの安全性と optional の厳密性を強制。

**採用**:

| フラグ | 理由 |
|---|---|
| `noUncheckedIndexedAccess: true` | `array[i]` が `T \| undefined` に。未定義アクセスを L0 で防止 |
| `exactOptionalPropertyTypes: true` | `prop?: string` と `prop: string \| undefined` を区別。意図しない undefined 代入を防止 |
| `noImplicitReturns: true` | 全コードパスで return を要求。抜け漏れを L0 で防止 |
| `noFallthroughCasesInSwitch: true` | switch の break 忘れを L0 で防止 |

**不採用**:

| フラグ | 理由 |
|---|---|
| `noPropertyAccessFromIndexSignature` | D1 の結果オブジェクトで摩擦が大きすぎる。保護/摩擦比が低い |

#### A2. ESLint ルール追加

**意図**: 現在の 1 ルール (no-floating-promises) に、設計判断をエンコードするルールを追加。

**採用**:

| ルール | レベル | 意図 |
|---|---|---|
| `no-console: 'error'` (worker/src/) | L1 | 全ログを型付き Logger 経由に強制。B4 の前提条件 |
| `@typescript-eslint/switch-exhaustiveness-check: 'error'` | L1 | sum type の全分岐網羅を強制。A1 の `noFallthroughCasesInSwitch` と補完 |
| `@typescript-eslint/no-explicit-any: 'error'` | L1 | any の使用を禁止。型安全性の抜け穴を塞ぐ |
| `@typescript-eslint/strict-boolean-expressions: 'error'` | L1 | `if (value)` の暗黙変換を禁止。`0`, `""`, `null` の誤判定を防止 |

**不採用**:

| ルール | 理由 |
|---|---|
| `eslint-plugin-import/order` | スタイル。保護価値がない。摩擦のみ |
| `eslint-plugin-functional/*` | FP 強制は過剰。このプロジェクトは手続き + 関数の混合が自然 |
| `max-lines`, `max-depth` | 数値閾値は文脈を無視する。レビューで判断すべき領域 |

#### A3. dependency-cruiser

**意図**: ADR-0008 のモジュール境界基準を自動強制。循環依存の再発を構造的に防止。

**採用**: `dependency-cruiser` を CI で実行。

ルール:

| ルール名 | 制約 | 意図 |
|---|---|---|
| `no-circular` | 全モジュールで循環依存禁止 | 現在ゼロだが、成長時の退行を防止 |
| `no-routes-to-pipeline` | `routes/*` → `pipeline/*` の import 禁止 | API レイヤーがパイプラインに直接依存しない |
| `no-lib-to-routes` | `lib/*` → `routes/*` の import 禁止 | lib は routes を知らない (依存の方向) |
| `no-lib-to-mcp` | `lib/*` → `mcp/*` の import 禁止 | lib は MCP を知らない |
| `no-lib-to-container` | `lib/*` → `container/*` の import 禁止 | lib は Container を知らない |

**不採用**: `eslint-plugin-boundaries` — dependency-cruiser の方が設定の表現力が高く、graph 可視化もできる。ツールの重複を避ける。

#### A4. Knip

**意図**: 未使用コードの蓄積を CI で自動検出・ブロック。

**採用**: `knip` を CI で実行 (presubmit)。

設定:
- `entry`: `worker/src/index.ts`
- `ignore`: `worker/src/lib/defuddle-bundle.mjs` (auto-generated)
- 検出対象: unused files, unused exports, unused dependencies
- CI 失敗条件: unused export が 1 つでもあれば fail

#### A5. セキュリティスキャン

**意図**: 既知の脆弱性パターンと秘密情報の漏洩を多層防御で検出。pre-commit (ローカル) + CI (リモート) の 2 重ゲート。

**採用**:

| ツール | 実行タイミング | 意図 |
|---|---|---|
| Gitleaks (pre-commit hook) | `git commit` 時 (ローカル) | 秘密情報のコミットを最速で阻止。CI に到達する前にブロック |
| secretlint | CI presubmit + ローカル | ソースコード内の秘密情報パターンを検出。Gitleaks が diff ベース (staged files) なのに対し、secretlint はファイル全体をスキャン。相互補完 |
| `npm audit --audit-level=high` | CI presubmit | 既知の脆弱な依存をブロック。`high` 以上のみ (low/moderate は摩擦が高すぎる) |
| GitHub Dependabot | 自動 PR | 脆弱な依存の自動更新 PR |

Gitleaks と secretlint の役割分担:

| 観点 | Gitleaks | secretlint |
|---|---|---|
| 実行タイミング | pre-commit (git hook) | CI + ローカル (`npm run lint:secrets`) |
| スキャン対象 | staged diff (コミット差分) | ファイル全体 |
| 検出方式 | 正規表現 + エントロピー分析 | プラグインベース (AWS, GCP, npm, Slack 等) |
| 強み | 高速、diff ベースで false positive 少 | ファイル全体スキャンで既存の漏洩も検出 |
| 弱み | 既存ファイルの漏洩は検出しない | diff を意識しない (CI での全体スキャン向き) |

**不採用**:

| ツール | 理由 |
|---|---|
| Semgrep | SAST は価値があるが、このプロジェクト規模 (23 ファイル) では保護/摩擦比が低い。D1 prepared statement で SQL injection は構造的に防止済み。XSS はサーバーサイド API のみで該当しない。規模が拡大したら再評価 |
| Snyk | npm audit + Dependabot と重複。無料枠の制限もある |

---

### Layer B 具体化: 動的強制

#### B1. テストハーネスのモジュール化

**意図**: 現在の `test/helpers.ts` (1 ファイル) を、public API boundary を持つモジュールに昇格。テストコードがハーネス内部に依存しない構造にする。

**採用**: テストハーネスを `test/harness/` に再構成。

```
test/
  harness/
    index.ts          <- 唯一の public API (re-exports)
    lifecycle.ts       <- setupTestDb, applyMigrations (既存 setupTestDb を移動)
    fixtures.ts        <- seedFeed, seedArticle, seedFeedWithArticles (既存 + 拡張)
    http.ts            <- fetchApi (既存を移動)
    mcp.ts             <- createTestMcpClient (既存パターンを抽出)
  unit/
  integration/
  e2e/
  architecture/        <- Layer D のフィットネス関数
```

**ファクトリ拡張**:

| 追加 | 意図 |
|---|---|
| `seedFeedWithArticles(count, feedOv, artOv)` | 複合シナリオのセットアップを 1 行で。テスト可読性向上 |
| sequence-based uniqueness (counter) | UUID より可読。デバッグ時に `Feed 1`, `Article 3` で識別可能 |
| `resetSeq()` in `setupTestDb()` | テスト間の独立性を保証 |

**不採用**:

| 要素 | 理由 |
|---|---|
| Request builder パターン (`ctx.api.get('/articles').withAuth()`) | 現在の `fetchApi()` で十分。API 表面積が小さく (6 routes)、builder の抽象化コストが利益を超える |
| Response asserter パターン | Vitest の `expect` で十分。ドメイン固有アサーションは過剰抽象化 |

#### B1-2. テスト強化

**意図**: 既存テストの弱点を補強し、新しいテストカテゴリを追加。

**採用**:

| 追加 | 意図 |
|---|---|
| Vitest coverage (`v8` provider) | テストカバレッジの計測と ratchet (autoUpdate) で退行防止 |
| `github-actions` reporter | PR に失敗箇所をインライン注釈。フィードバック遅延を短縮 |
| `fast-check` (property-based testing) | RRF, trigram, URL cleaner, FTS5 sanitizer のエッジケースを発見 |
| Zod contract tests | API レスポンスのスキーマ drift を検出。MCP ← → API 間の契約 |
| Workflow step idempotency tests | `build_trigram`, `tokenize` の 2 回実行で結果不変を保証 |
| Coverage thresholds (ratchet) | `lines: 70, branches: 60, functions: 70`, `autoUpdate: true` |

**不採用**:

| 要素 | 理由 |
|---|---|
| Mutation testing (Stryker) | workerd pool と非互換。pure function のみに限定すれば可能だが、セットアップコストに対して 23 ファイルの規模では保護/摩擦比が低い。規模拡大時に再評価 |
| Snapshot testing | API レスポンスには不適 (契約の詳細が隠れる)。Zod contract tests の方が明示的 |
| Visual regression | サーバーサイド API のみ。該当なし |

#### B2. 境界バリデーション (Zod + @hono/zod-validator)

**意図**: API routes の入力バリデーションを MCP と同じ水準 (Zod) に統一。Parse, Don't Validate を全境界で実現。

**採用**: `@hono/zod-validator` + route 別 Zod スキーマ。

対象 routes:

| Route | バリデーション対象 |
|---|---|
| `POST /feeds` | body: url, rss_url, name |
| `PATCH /feeds/:id` | body: optional fields |
| `POST /opml` | body: XML string (構造検証) |
| `PATCH /articles/:id` | body: is_read, is_bookmarked, is_liked |
| `GET /articles` | query: limit, offset, feed_id, category_id, is_bookmarked, is_read |
| `GET /articles/search` | query: q, limit, offset |

**不採用**: Branded types for IDs (ArticleId, FeedId) — D1 の row は plain number を返す。全箇所で変換が必要になり摩擦が非常に高い。Zod スキーマの `z.coerce.number().int().positive()` で十分な保護が得られる。

#### B3. 安定性パターン追加

**意図**: 既存の Timeout + Bulkhead + Steady State に加え、欠けているパターンを補完。

**採用**:

| パターン | 実装箇所 | 意図 |
|---|---|---|
| Fail Fast | `article-workflow.ts` の `fetch_rss` ステップ | URL 形式不正なら即座に失敗。リトライを浪費しない |

**不採用**:

| パターン | 理由 |
|---|---|
| Circuit Breaker (Container) | Workflows の retry 機構が実質的に circuit breaker として機能。3 回リトライ失敗でステップは fail し、次回の cron まで再試行しない。専用の CB 実装は重複 |
| Rate limiter (API) | OAuth 認証でユーザーが 1 人 (GITHUB_ALLOWED_USERNAME)。レートリミットの対象がない |
| Load shedding | Workers は Cloudflare のインフラで自動スケール。アプリレベルの load shedding は不要 |

#### B4. 可観測性

**意図**: console.log 2 箇所の状態から、全統合点が自動でイベント発行する状態にする。

**採用**:

| 要素 | 実装 | 意図 |
|---|---|---|
| `[observability]` in wrangler.toml | `enabled = true`, `head_sampling_rate = 1` | Workers Logs 有効化。ゼロコストで全 console 出力を searchable に |
| 型付き Logger (`src/lib/logger.ts`) | `LogEvent` interface + domain-specific factories | `console.log(string)` を型エラーに。構造化ログの基盤 |
| Hono request middleware | 全リクエストの method, path, status, duration を自動記録 | 新ルート追加時に自動カバー |
| Workflow step wrapper | `step.do` のラッパーで step name, duration, outcome を自動記録 | 新ステップ追加時に自動カバー |
| Correlation ID | API: `X-Request-ID` ヘッダー。Pipeline: workflow instance ID (`feed-{id}-{ts}`) | リクエスト/パイプラインの全イベントを紐付け |

**不採用**:

| 要素 | 理由 |
|---|---|
| Tail Worker | 現時点ではイベント量が少なく、Workers Logs のダッシュボード検索で十分。SLO 定義後に再評価 |
| Analytics Engine | SLI のメトリクス集計に必要だが、まず Logger + Workers Logs で基盤を作り、SLO 定義時に追加 |
| SLO / Error Budget | 数値を定義するにはまずメトリクスが必要。Logger 導入後にベースラインを計測してから SLO を設定する。順序: Logger → メトリクス計測 (2 週間) → SLO 定義 |

---

### Layer C 具体化: プロセス強制

#### C1. CI パイプライン (Worker テスト追加)

**意図**: Worker テストが CI に入っていない最大の穴を塞ぐ。全ハーネスの L1 強制を presubmit に統合。

**採用**: `.github/workflows/test.yaml` に以下を追加。

Presubmit (PR 時):

| ステップ | 順序 | 意図 |
|---|---|---|
| `tsc --noEmit` (worker) | 1 (並列) | 型エラーを最速で検出 |
| `eslint` (worker) | 1 (並列) | ルール違反を最速で検出 |
| `npx depcruise src` (worker) | 1 (並列) | 循環依存 / レイヤー違反をブロック |
| `npx knip` (worker) | 1 (並列) | dead code をブロック |
| `npm audit --audit-level=high` (worker) | 1 (並列) | 脆弱な依存をブロック |
| `npx secretlint "**/*"` | 1 (並列) | 秘密情報パターンの全体スキャン |
| `vitest run --coverage --reporter=github-actions` (worker) | 2 (依存: tsc pass 後) | テスト実行 + カバレッジ |

Reporters:

| Reporter | 意図 |
|---|---|
| `default` | コンソール出力 (ローカル + CI ログ) |
| `github-actions` | PR のファイル diff にインライン注釈 |
| `junit` (CI のみ) | CI ダッシュボードのテスト結果表示 |

**不採用**:

| 要素 | 理由 |
|---|---|
| Test sharding | 22 テストファイル、実行時間 < 1 分。sharding のオーバーヘッドが利益を超える |
| Post-submit E2E | E2E は `OKSSKOLTEN_API_KEY` が必要。Secret を CI に入れれば可能だが、現時点ではローカル実行で十分。デプロイ自動化時に再評価 |
| Flaky test quarantine | 現時点でフレイキーテストの問題がない。問題が発生したら `vitest retry: 2` + quarantine を導入 |

#### C2. デプロイ安全性

**意図**: `wrangler deploy` の安全性を高める。

**採用**:

| 要素 | 実装 | 意図 |
|---|---|---|
| Post-deploy smoke test | deploy 後に `GET /api/health` を叩いて 200 を確認 | デプロイ直後の即時フィードバック |
| CI gate before deploy | test + lint + typecheck が pass しなければ deploy しない | deploy scripts に `predeploy` hook で enforce |

**不採用**:

| 要素 | 理由 |
|---|---|
| Feature flags | ユーザーが 1 人。機能の段階的ロールアウトは不要 |
| Canary deployment | Workers は即時全展開。Cloudflare の gradual rollout は Enterprise のみ |
| 自動ロールバック | Workers は `wrangler rollback` で手動復帰が秒単位。自動化の投資対効果が低い |

#### C3. Dependabot

**意図**: 依存の鮮度を自動で維持。

**採用**: `.github/dependabot.yml` を追加。

- `worker/` と root の `package.json` を週次でチェック
- security updates は即時 PR
- version updates は週次 PR (グループ化)
- auto-merge: patch + minor (CI pass 条件)

---

### Layer D 具体化: 構造強制

#### D1. フィットネス関数

**意図**: 現在のクリーンなモジュール構造を、成長しても維持できるよう自動テストで保護。

**採用**: `test/architecture/fitness.test.ts` を新設。

| フィットネス関数 | 検証内容 | 意図 |
|---|---|---|
| No circular dependencies | `depcruise --output-type err` の結果が空 | 循環依存の再発を防止 |
| lib は routes/mcp/pipeline/container を知らない | `lib/*` → `{routes,mcp,pipeline,container}/*` の import が 0 | 依存の方向を強制 |
| routes は pipeline を知らない | `routes/*` → `pipeline/*` の import が 0 | API と非同期パイプラインの分離 |
| 全 public export の使用 | Knip の unused exports が 0 | 不要な API 表面積の拡大を防止 |

**不採用**:

| 要素 | 理由 |
|---|---|
| API Extractor | 公開 API が内部向け (Workers binding) のみ。外部 consumer がいないため、API surface tracking は不要 |
| Ca/Ce coupling metrics | 23 ファイルでは計測値が揺らぎやすく信頼性が低い。50+ ファイル時に再評価 |
| Deep module ratio 自動計測 | 定量化が難しく false positive が多い。レビューで判断する L3 領域 |
| Max exports per module | 現状で最大 export 数が適正。閾値の数値根拠がない。問題が発生したら導入 |

---

### Layer E 具体化: 衛生強制

#### E1. Knip (Dead code)

**意図**: Layer A4 と同一。CI presubmit で未使用コードをブロック。

(A4 で決定済み)

#### E2-E3. 意味的重複 / 偽の抽象化

**意図**: 自動検出が困難な領域。レビューガイドラインとして文書化し、L3 で対応。

**採用**: HARNESS.md にレビュー観点として記載 (本ドキュメント)。

チェックリスト:
- [ ] このユーティリティの全呼び出し元は同じ意味で使っているか？
- [ ] このジェネリック型は 2 箇所以上でインスタンス化されているか？
- [ ] このラッパー関数は内部の関数に何かを足しているか？

#### E4. Dependabot (依存鮮度)

**意図**: Layer C3 と同一。

(C3 で決定済み)

---

### 採用・不採用の判断基準サマリ

採用したもの:

| ID | 要素 | Layer | Level | 意図 (一行) |
|---|---|---|---|---|
| A1-1 | `noUncheckedIndexedAccess` | A | L0 | 配列アクセスの安全性 |
| A1-2 | `exactOptionalPropertyTypes` | A | L0 | optional の厳密性 |
| A1-3 | `noImplicitReturns` | A | L0 | return 抜け漏れ防止 |
| A1-4 | `noFallthroughCasesInSwitch` | A | L0 | switch break 忘れ防止 |
| A2-1 | `no-console` | A | L1 | 構造化ログ強制の前提 |
| A2-2 | `switch-exhaustiveness-check` | A | L1 | sum type 全分岐網羅 |
| A2-3 | `no-explicit-any` | A | L1 | 型安全性の抜け穴封鎖 |
| A2-4 | `strict-boolean-expressions` | A | L1 | 暗黙型変換の防止 |
| A3 | dependency-cruiser | A | L1 | 循環依存 + レイヤー違反の自動拒否 |
| A4 | Knip | A/E | L1 | dead code 自動検出 |
| A5-1 | Gitleaks (pre-commit) | A | L1 | 秘密情報のコミット阻止 (diff ベース) |
| A5-2 | secretlint | A | L1 | 秘密情報パターン検出 (ファイル全体スキャン) |
| A5-3 | npm audit + Dependabot | A | L1 | 脆弱性 + 依存鮮度 |
| B1-1 | harness module 化 | B | — | テストコードとハーネスの分離 |
| B1-2 | coverage + ratchet | B | L1 | カバレッジ退行防止 |
| B1-3 | `fast-check` | B | L1 | プロパティベーステスト |
| B1-4 | Zod contract tests | B | L1 | API スキーマ drift 防止 |
| B1-5 | `github-actions` reporter | B | L1 | PR インライン注釈 |
| B2 | Zod + @hono/zod-validator | B | L0 | 全 API route の入力バリデーション |
| B3 | Fail Fast (fetch_rss) | B | L1 | 無効 URL の即時拒否 |
| B4-1 | `[observability]` in wrangler.toml | B | L1 | Workers Logs 有効化 |
| B4-2 | 型付き Logger | B | L0 | 構造化ログの型強制 |
| B4-3 | Hono request middleware | B | L1 | 全リクエスト自動記録 |
| B4-4 | Workflow step wrapper | B | L1 | 全ステップ自動記録 |
| B4-5 | Correlation ID | B | L1 | イベント紐付け |
| C1 | Worker テスト CI 追加 | C | L1 | 最大の穴を塞ぐ |
| C2 | Post-deploy smoke test | C | L1 | デプロイ直後の即時確認 |
| C3 | Dependabot | C | L1 | 依存自動更新 |
| D1 | フィットネス関数 (4 種) | D | L1 | 構造の自動保護 |

不採用としたもの (理由付き):

| 要素 | 不採用理由 |
|---|---|
| `noPropertyAccessFromIndexSignature` | D1 結果オブジェクトで摩擦大 |
| `eslint-plugin-import/order` | スタイルのみ。保護価値なし |
| `eslint-plugin-functional` | FP 強制は過剰。混合スタイルが自然 |
| `max-lines`, `max-depth` | 数値閾値は文脈無視 |
| `eslint-plugin-boundaries` | dependency-cruiser と重複 |
| Semgrep SAST | 規模 23 ファイルで保護/摩擦比低。D1 prepared statement で SQL injection 防止済み |
| Snyk | npm audit + Dependabot と重複 |
| Branded types for IDs | D1 row が plain number。全箇所の変換摩擦が過大 |
| Request builder pattern | 6 routes で `fetchApi()` が十分 |
| Response asserter pattern | `expect` で十分 |
| Mutation testing (Stryker) | workerd 非互換 + 規模に対してコスト過大 |
| Snapshot testing | 契約の詳細が隠れる。Zod contract tests の方が明示的 |
| Circuit Breaker (専用) | Workflows retry が実質 CB |
| Rate limiter | ユーザー 1 人。対象なし |
| Load shedding | Workers 自動スケール |
| Tail Worker | イベント量少。Workers Logs で十分 |
| Analytics Engine | Logger 導入後に再評価 |
| SLO / Error Budget | メトリクス計測後に定義 (Logger → 2 週計測 → SLO) |
| Feature flags | ユーザー 1 人 |
| Canary deployment | Enterprise のみ |
| 自動ロールバック | `wrangler rollback` で秒単位復帰可能 |
| Test sharding | 22 ファイル < 1 分 |
| Post-submit E2E in CI | Secret 管理のコスト |
| Flaky quarantine | 現時点で問題なし |
| API Extractor | 外部 consumer なし |
| Ca/Ce metrics | 23 ファイルで揺らぎ大 |
| Deep module ratio 自動計測 | false positive 多。レビュー領域 |
| Max exports per module | 閾値の根拠不足 |
