#!/usr/bin/env bash
# Stop: Docker 不要の高速チェック (biome + tsc) を回し、失敗なら exit 2 で差し戻す。
# 加えて不変条件4 (engine を変えたら FIDELITY.md も更新) を警告として出す。
set -uo pipefail

input=$(cat)

# 再入防止: このフックが起こした Stop では何もしない
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

if git rev-parse --git-dir >/dev/null 2>&1; then
  changed=$(git status --porcelain -- packages/engine 2>/dev/null)
  fidelity=$(git status --porcelain -- docs/FIDELITY.md 2>/dev/null)
  if [ -n "$changed" ] && [ -z "$fidelity" ]; then
    printf '警告(不変条件4): packages/engine に変更がありますが docs/FIDELITY.md が未更新です。MySQL と挙動を変えたなら同じ変更で台帳を更新してください。\n' >&2
  fi
fi

if ! out=$(pnpm run check:fast 2>&1); then
  printf 'pnpm check:fast が失敗しました。修正してください。\n\n%s\n' "$out" >&2
  exit 2
fi

exit 0
