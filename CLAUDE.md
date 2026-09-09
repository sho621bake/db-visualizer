# DB Visualizer

MySQL (InnoDB) のクエリ実行を3Dアニメーションで学ぶサイト。設計は `docs/DESIGN.md`、計画は `docs/PLAN.md`、実物との差分は `docs/FIDELITY.md` を正とする。

## 構成

- `packages/engine`: 純TS。SQL → PlanTree → Trace (StepEvent[]) を生成。**DOM / React / three.js に依存しない**
- `apps/web`: React + react-three-fiber。Trace を再生して描画するだけ。エンジンのロジックを持たない
- `tools/mysql`: docker-compose (mysql:8.4) と seed.sql。plan-consistency テストの基準

## コマンド

```
pnpm check        # biome check + tsc --noEmit + vitest run  ← 完了条件
pnpm e2e          # playwright
pnpm mysql:up     # docker compose -f tools/mysql/docker-compose.yml up -d
pnpm dev          # apps/web の dev server
```

Docker が無い環境では `PLAN_TEST=skip pnpm check`。ただしエンジンの planner/executor を変更した場合は必ず Docker を起動して `pnpm check` を通す。

## 不変条件 (hooks で機械的に検査される)

1. Trace は決定論的: 同じ SQL + 同じシードで同じ StepEvent[] が出る (スナップショットテスト)
2. `packages/engine` から `apps/web` / `three` / `react` を import しない
3. StepEvent の `type` を追加したら `apps/web/src/glossary/ja.ts` に解説を追加する (型で網羅を強制。欠落は tsc エラー)
4. MySQL と挙動を変えるときは `docs/FIDELITY.md` を同じ変更で更新する

## 作業ルール

- タスクを受けたら、目的・制約・完了条件・出力形式の4点が揃っているか確認する。**完了条件が無ければ着手前に確認する**
- 1マイルストーン (docs/PLAN.md) を超える変更を1回の作業でしない
- MySQL の挙動が不明な点は推測で実装せず、`tools/mysql` の実 MySQL で `EXPLAIN FORMAT=JSON` / `EXPLAIN FORMAT=TREE` を実行して確認する。確認結果はテストに固定する
- サポート範囲外の SQL は黙って近似せず「未対応」を返す
- 依存追加は理由を PR 説明に書く。候補: node-sql-parser, zod, zustand, @react-three/fiber, @react-three/drei, @codemirror/*
- CSS / 見た目の判断は細かく質問せず、DESIGN.md §5 の方針 (色3系統・凡例常時表示・装飾最小) で進める

## サブエージェント

- `plan-verifier`: Docker の MySQL に対して plan-consistency テストを実行し、差分を要約する。planner/executor を変更した後に使う
- `fidelity-reviewer`: 変更差分を `docs/FIDELITY.md` と MySQL 公式ドキュメントに照らして読み取り専用でレビューする

## スキル

- `add-trace-event`: StepEvent 種別の追加手順 (schema → executor → glossary → scene → snapshot テスト)

## 触らないもの

- `tools/mysql/seed.sql` の既存行 (追加は可。既存行を変えると全スナップショットと MySQL 基準が壊れる)
- `pnpm-lock.yaml` の手編集
