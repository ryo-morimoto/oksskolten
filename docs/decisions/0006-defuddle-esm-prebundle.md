---
status: "accepted"
date: 2026-03-22
decision-makers: ryo-morimoto
---

# Pre-bundle defuddle/node with esbuild for workerd CJS compatibility

## Context and Problem Statement

`defuddle/node` はCJSで配布されている。workerdのモジュール評価器はCJS（`exports.xxx = ...`）を直接実行できず、`exports is not defined` エラーが発生する。wrangler deployのesbuildバンドルでは動くが、vitest-pool-workers（テスト環境）では動かない。

## Decision Drivers

* 本番（wrangler deploy）とテスト（vitest-pool-workers）の両方で同じコードが動くこと
* defuddleのバージョンアップに追従できること
* gitにバンドル済みファイルをコミットしないこと

## Considered Options

* esbuildでpre-bundle（CJS→ESMに変換した.mjsファイルを生成）
* defuddleのブラウザ版（UMD）を直接import + 自前のlinkedom/Turndown統合
* defuddleがESMネイティブ配布に移行するのを待つ

## Decision Outcome

Chosen option: "esbuildでpre-bundle", because 本番・テスト両方で動作し、defuddleのバージョンアップ時は `node scripts/bundle-defuddle.mjs` 再実行で追従できる。

### Consequences

* Good, because defuddle/nodeの全機能（linkedom-compat polyfills + Turndown Markdown変換）がそのまま使える
* Good, because pretest/predev/predeployで自動生成されるため手動ステップなし
* Good, because lockfileより新しければスキップ（~0ms）
* Bad, because defuddleアップグレード時にバンドル再生成が必要（自動だが認識は必要）
* Bad, because バンドルサイズ743KB（minify後）がWorkerバンドルの43%を占める

### Confirmation

* `.gitignore` に `src/lib/defuddle-bundle.mjs` を追加済み
* `package.json` の `pretest`/`predev`/`predeploy` でバンドルスクリプトが自動実行
* バンドルが存在しない状態から `npm test` で自動再生成されることを確認済み

## More Information

公式サイト（defuddle.md）はソースから直接importしている（`../../src/defuddle`）。npmパッケージ利用者はこのCJSの壁にあたる。defuddleがESM配布に移行したら本ADRは廃止できる。
