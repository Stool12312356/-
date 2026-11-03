#!/usr/bin/env bash
# budget.sh — сколько занимает воркспейс в снапшоте Arena.
#
# Лимит платформы: 128 МБ и 10 000 файлов на всю сессию.
# Всё, что попадает в снапшот, считается. Папки сборки/зависимостей — не считаются.
#
# Использование:  ./tools/budget.sh [--top]
set -uo pipefail

LIMIT_MB=128
LIMIT_FILES=10000

# Имена, которые платформа исключает из снапшота.
EXCLUDE_DIRS=(
  .arena .cache .local .mypy_cache .next .nox .npm .nuxt .output
  .parcel-cache .playwright-cli .pytest_cache .ruff_cache .svelte-kit
  .tox .turbo .venv .vite __pycache__ build coverage dist node_modules out target
)
# Каталоги, где лежат медиа (в снапшот не должны попадать вовсе).
WARN_DIRS=(media renders exports footage raw)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

prune_expr=()
for d in "${EXCLUDE_DIRS[@]}"; do
  prune_expr+=(-name "$d" -o)
done
unset 'prune_expr[${#prune_expr[@]}-1]'

# Собираем список файлов снапшота.
mapfile -d '' FILES < <(
  find "$ROOT" \( -type d \( "${prune_expr[@]}" \) -prune \) -o \
       \( -type f -print0 \) 2>/dev/null
)

total_bytes=0
for f in "${FILES[@]}"; do
  sz=$(stat -c %s -- "$f" 2>/dev/null || echo 0)
  total_bytes=$((total_bytes + sz))
done

total_mb=$(( total_bytes / 1048576 ))
count=${#FILES[@]}

printf '\n=== Бюджет снапшота: %s ===\n' "$ROOT"
printf 'Объём : %6s МБ  из %s МБ   (%d%%)\n' \
  "$total_mb" "$LIMIT_MB" "$(( total_mb * 100 / LIMIT_MB ))"
printf 'Файлов: %6s     из %s      (%d%%)\n' \
  "$count" "$LIMIT_FILES" "$(( count * 100 / LIMIT_FILES ))"

status=0
if (( total_mb > LIMIT_MB )); then
  printf '\n\033[31m[ПРЕВЫШЕН] объём больше %s МБ — часть файлов может не сохраниться.\033[0m\n' "$LIMIT_MB"
  status=1
elif (( count > LIMIT_FILES )); then
  printf '\n\033[31m[ПРЕВЫШЕН] файлов больше %s\033[0m\n' "$LIMIT_FILES"
  status=1
elif (( total_mb * 100 / LIMIT_MB > 80 )); then
  printf '\n\033[33m[ВНИМАНИЕ] израсходовано больше 80%% бюджета.\033[0m\n'
else
  printf '\n\033[32m[OK] запас есть.\033[0m\n'
fi

# Медиа-каталоги: если что-то в них лежит — это прямой риск.
for d in "${WARN_DIRS[@]}"; do
  if [ -d "$ROOT/$d" ]; then
    n=$(find "$ROOT/$d" -type f ! -name 'README.md' 2>/dev/null | wc -l)
    if (( n > 0 )); then
      printf '\033[33m[РИСК] %s/: %s файл(ов) не в Git, но занимают диск снапшота.\033[0m\n' "$d" "$n"
    fi
  fi
done

if [ "${1:-}" = "--top" ]; then
  echo
  echo "=== 15 самых крупных файлов в снапшоте ==="
  for f in "${FILES[@]}"; do
    printf '%s\t%s\n' "$(stat -c %s -- "$f" 2>/dev/null || echo 0)" "${f#"$ROOT"/}"
  done | sort -rn | head -15 | awk -F'\t' '{ printf "%8.2f МБ  %s\n", $1/1048576, $2 }'
fi

exit "$status"
