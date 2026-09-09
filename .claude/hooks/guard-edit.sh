#!/usr/bin/env bash
# PreToolUse (Edit|Write): CLAUDE.md「触らないもの」「不変条件2」を機械的に守らせる。
# ブロックは exit 2 + stderr。stdin は Claude Code の hook JSON。
set -uo pipefail

input=$(cat)

file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')
[ -z "$file_path" ] && exit 0

# 内容は Write の content / Edit の new_string のどちらか
content=$(printf '%s' "$input" | jq -r '(.tool_input.content // "") + "\n" + (.tool_input.new_string // "")')

rel="${file_path#"${CLAUDE_PROJECT_DIR:-}/"}"

block() {
  printf '%s\n' "$1" >&2
  exit 2
}

case "$rel" in
  pnpm-lock.yaml|*/pnpm-lock.yaml)
    block "pnpm-lock.yaml は手編集禁止 (CLAUDE.md「触らないもの」)。pnpm install で更新すること。"
    ;;
  tools/mysql/seed.sql)
    block "tools/mysql/seed.sql は生成物です。tools/mysql/generate-seed.mjs を直して 'pnpm seed:gen' で再生成してください (既存行を変えると全スナップショットと MySQL 基準が壊れます)。"
    ;;
  packages/engine/src/catalog/seed-data.generated.ts)
    block "seed-data.generated.ts は生成物です。'pnpm seed:gen' で再生成してください。"
    ;;
esac

case "$rel" in
  packages/engine/*)
    if printf '%s' "$content" | grep -Eq "from '(react|react-dom|three)'|from \"(react|react-dom|three)\"|@react-three/|apps/web"; then
      block "不変条件2 違反: packages/engine は apps/web / three / react に依存できません (DESIGN.md §3)。"
    fi
    ;;
esac

exit 0
