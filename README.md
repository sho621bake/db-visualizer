# DB Visualizer

MySQL (InnoDB) のクエリ実行を3Dアニメーションで学ぶサイト。

SQL を入力すると、自前の教育用擬似エンジンが「オプティマイザが何を選び、どのページ・どの
B+Tree ノードをどの順に触るか」を決定論的なイベント列 (Trace) として吐き、3D シーンがそれを
再生する。教材が嘘をつかないことは、同一シードを入れた実 MySQL 8.4 (Docker) との
plan-consistency テストで固定している。

- 設計: [`docs/DESIGN.md`](docs/DESIGN.md)
- 計画とマイルストーン: [`docs/PLAN.md`](docs/PLAN.md)
- 実物との差分台帳: [`docs/FIDELITY.md`](docs/FIDELITY.md)

**現在の実装状況**: M0 (足場) と M1 (エンジン) まで。M2 の 3D シーンは未実装で、`apps/web` は
プレースホルダ画面と用語解説 (`src/glossary/ja.ts`) だけを持つ。

## セットアップ

必要なもの: Node.js 22 以上 / pnpm 9 / Docker (plan-consistency テスト用) / jq (hooks 用)。

```bash
pnpm install
pnpm exec playwright install chromium   # e2e を回すときだけ
pnpm mysql:up                           # mysql:8.4 を 127.0.0.1:13306 に立て、seed.sql を流す
```

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm check` | **完了条件**。biome check + tsc --noEmit + vitest run (unit / snapshot / plan-consistency) |
| `pnpm check:fast` | Docker 不要の高速チェック (biome + tsc)。Stop hook が呼ぶ |
| `pnpm e2e` | Playwright。`apps/web` をビルドして preview 起動し検証する |
| `pnpm dev` | `apps/web` の dev server |
| `pnpm mysql:up` / `pnpm mysql:down` | MySQL コンテナの起動 / 破棄 |
| `pnpm seed:gen` | シードの再生成 (`seed.sql` と `seed-data.generated.ts` を同時に出力) |

Docker が無い環境では `PLAN_TEST=skip pnpm check`。ただし `packages/engine` の planner /
executor を変更した場合は必ず Docker を起動して `pnpm check` を通すこと。

## ディレクトリ

```
packages/engine/          純TS。DOM / React / three.js に依存しない
  src/catalog/            テーブル定義・シードデータ・統計
  src/storage/            ページ / B+Tree / バッファプール / Database
  src/parser/             node-sql-parser → 内部AST (範囲外は「未対応: ○○」)
  src/planner/            候補アクセスパス列挙 → コスト → PlanTree → EXPLAIN
  src/executor/           Volcano (iterator) モデル。実行しながら StepEvent を emit
  src/trace/              StepEvent スキーマ (zod) と採番
  src/scenarios.ts        DESIGN.md 7 のシナリオ定義 (UI プリセットとテストの共通の元)
apps/web/                 React + Vite。Trace を再生して描画するだけ
  src/glossary/ja.ts      StepEvent 種別 → 日本語解説 (網羅を型で強制)
tools/mysql/              docker-compose (mysql:8.4) + シード生成器 + 実MySQLとの突き合わせ
  fixtures/               実 MySQL から採取した EXPLAIN JSON / TREE / 結果集合
e2e/                      Playwright
.claude/                  hooks / サブエージェント / スキル
```

## 不変条件 (hooks とテストで機械的に検査される)

1. **Trace は決定論的** — `packages/engine/test/trace.snapshot.test.ts` がスナップショットで固定
2. **`packages/engine` は UI に依存しない** — `.claude/hooks/guard-edit.sh` (import 指定子を検査)
   と `packages/engine/test/no-ui-imports.test.ts` の二重で固定
3. **StepEvent 種別の解説文は欠かせない** — `Record<StepEvent['type'], Glossary>` により
   `tsc --noEmit` が落ちる
4. **MySQL と挙動を変えたら `docs/FIDELITY.md` を同じ変更で更新** — Stop hook が警告する

種別を追加する手順は `.claude/skills/add-trace-event/SKILL.md`。

## 依存追加の理由

| 依存 | 理由 |
|---|---|
| `node-sql-parser` | MySQL 方言の AST 化 (DESIGN.md 2)。パーサ自作は学習価値が低い |
| `zod` | StepEvent スキーマ (DESIGN.md 4.4)。Trace の JSON 検証に使う |
| `mysql2` (`tools/mysql` の devDep) | plan-consistency テストが `EXPLAIN FORMAT=JSON` と結果集合を型付きで取得するため |

## 実装メモ

- `vitest.workspace.ts` は Vitest 3.2 で非推奨・4 で廃止されたため、`vitest.config.ts` の
  `test.projects` で engine / web / tools-mysql の3プロジェクトを構成している。
- `*.generated.ts` は生成器が唯一の真実なので biome の対象外。整形すると再生成で差分が出る。
- TypeScript は 7.0.2 (ネイティブ実装版) をそのまま使用。フォールバックは不要だった。
