---
name: add-trace-event
description: StepEvent の新しい種別を追加するときの手順。schema → executor → glossary → scene → snapshot テストの順で、不変条件1(決定論)と不変条件3(解説文の網羅)を壊さずに追加する。
---

# StepEvent 種別の追加手順

DESIGN.md §4.4 の Trace スキーマに種別を1つ足すときの手順。**この順序で行う**。
途中で `pnpm check:fast` を回すと、抜けが tsc エラーとして出る。

## 1. schema — `packages/engine/src/trace/events.ts`

zod の discriminated union に1メンバー追加する。

- `type` はドット区切りの小文字 (`page.read`, `btree.descend` と同じ語彙)
- payload は**描画に必要な最小限**にする。派生できる値は入れない (Trace が肥大すると決定論スナップショットの差分が読めなくなる)
- `seq` / `nodeId` は共通フィールドなので個別に足さない

## 2. executor — `packages/engine/src/executor/`

イベントを emit する場所を決め、`TraceCollector.emit()` を呼ぶ。

- emit 順が実行順と一致していること (スナップショットが実行順の仕様書になる)
- 乱数・時刻・`Map` の挿入順に依存しない値だけを payload に入れる (**不変条件1: 決定論**)

## 3. glossary — `apps/web/src/glossary/ja.ts`

`Record<StepEvent['type'], Glossary>` なので、**追加しないと tsc が落ちる** (不変条件3)。

- `term`: 画面に出す用語 (日本語)
- `summary`: 1文。ホバー時に出る
- `detail`: 2〜4文。「何が起きたか」「なぜ重要か」を書く
- MySQL の対応する概念名 (`Using index` など) があれば必ず併記する

## 4. scene — `apps/web/src/scene/`

3D 表現を足す。M2 未実装の間はここを飛ばしてよい (glossary までで tsc は通る)。

- 色は DESIGN.md §5 の3系統 (ディスクI/O=赤系 / バッファプールヒット=緑系 / 棄却=灰) から選ぶ
- 新しい色を増やしたくなったら、まず既存3系統で表せないか検討する

## 5. snapshot テスト — `packages/engine/test/trace.snapshot.test.ts`

`pnpm vitest run --project engine -u` でスナップショットを更新し、**差分を目で読む**。

- 意図した箇所にだけ新イベントが増えていること
- 既存イベントの `seq` がずれる場合、それが仕様変更として妥当か確認する

## 6. 台帳

MySQL の挙動に対する再現度が変わったなら `docs/FIDELITY.md` の該当行を同じ変更で更新する
(**不変条件4**)。新しい簡略化を入れたなら行を追加する。

## 完了確認

```
pnpm check
```
