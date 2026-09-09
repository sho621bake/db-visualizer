# InnoDB Visualizer — 設計・計画パッケージ

このディレクトリをそのままリポジトリのルートに展開して使う。

- `CLAUDE.md` — Claude Code 向けプロジェクト指示
- `docs/DESIGN.md` — 設計書
- `docs/PLAN.md` — マイルストーンと完了条件
- `docs/FIDELITY.md` — 実物との差分台帳
- `.claude/settings.json` — hooks (PreToolUse guard / PostToolUse biome / Stop check)
- `.claude/hooks/*.sh` — hook 本体 (jq が必要)
- `.claude/agents/` — plan-verifier / fidelity-reviewer
- `.claude/skills/add-trace-event/` — StepEvent 追加手順

hooks が参照するスクリプト: `pnpm check`, `pnpm check:fast`, `pnpm mysql:up` は M0 で package.json に定義する。
