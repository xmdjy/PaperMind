#!/usr/bin/env bash
# 用本机 ds profile 重跑完整 PaperMind QA。只有 179/179、零错误的结果才覆盖正式归档。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
db_path="$HOME/Library/Application Support/papermind/papermind.db"
profile_name="${PAPERMIND_BENCH_PROFILE:-ds}"
results_dir="$repo_root/bench/results"
final_out="$results_dir/qa-full-papermind-v1.json"
temp_out="$results_dir/.qa-full-papermind-v1.$$.json"

cleanup() {
  rm -f "$temp_out"
}
trap cleanup EXIT

if [[ ! -f "$db_path" ]]; then
  echo "找不到 PaperMind 配置数据库：$db_path" >&2
  exit 1
fi

profile="$(sqlite3 -separator $'\x1f' "$db_path" "
  SELECT json_extract(json_each.value, '\$.provider'),
         json_extract(json_each.value, '\$.model'),
         json_extract(json_each.value, '\$.baseUrl'),
         json_extract(json_each.value, '\$.apiKey')
  FROM settings, json_each(settings.value)
  WHERE settings.key = 'llm_profiles'
    AND json_extract(json_each.value, '\$.name') = '$profile_name';
")"

if [[ -z "$profile" ]]; then
  echo "未找到 LLM profile：$profile_name" >&2
  exit 1
fi

IFS=$'\x1f' read -r BENCH_LLM_PROVIDER BENCH_LLM_MODEL BENCH_LLM_BASE_URL BENCH_LLM_API_KEY <<< "$profile"
if [[ -z "${BENCH_LLM_MODEL:-}" || -z "${BENCH_LLM_BASE_URL:-}" || -z "${BENCH_LLM_API_KEY:-}" ]]; then
  echo "profile $profile_name 缺少 model、baseUrl 或 apiKey" >&2
  exit 1
fi
export BENCH_LLM_PROVIDER BENCH_LLM_MODEL BENCH_LLM_BASE_URL BENCH_LLM_API_KEY

mkdir -p "$results_dir"
cd "$repo_root"
echo "[$(date '+%F %T')] 开始完整 PaperMind QA（结果将在 179/179、零错误后覆盖正式文件）"
npm run bench -- --task qa --dataset qasper --config default --out "$temp_out"

node -e '
  const fs = require("node:fs")
  const file = process.argv[1]
  const result = JSON.parse(fs.readFileSync(file, "utf8"))
  const { completed, total } = result.meta
  const errors = result.errors.length
  if (completed !== total || errors !== 0) {
    throw new Error(`拒绝覆盖不完整结果：${completed}/${total}，失败 ${errors}`)
  }
' "$temp_out"

mv "$temp_out" "$final_out"
trap - EXIT
echo "[$(date '+%F %T')] 完成并覆盖 $final_out"
