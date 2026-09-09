#!/usr/bin/env bash
# PostToolUse (Edit|Write): 触ったファイル1本だけ biome で整形する。
set -uo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')
[ -z "$file_path" ] && exit 0
[ -f "$file_path" ] || exit 0

case "$file_path" in
  *.ts|*.tsx|*.json) ;;
  *) exit 0 ;;
esac

# 生成物は生成器が唯一の真実なので整形しない
case "$file_path" in
  *.generated.ts) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
pnpm exec biome check --write "$file_path" >/dev/null 2>&1 || true
exit 0
