#!/usr/bin/env bash
# 顺序跑传统 RAG 三个基线。凭据只从本机 PaperMind 的 ds profile 读取，不写入日志或结果文件。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
db_path="$HOME/Library/Application Support/papermind/papermind.db"
profile_name="${PAPERMIND_BENCH_PROFILE:-ds}"
results_dir="$repo_root/bench/results"

if [[ ! -f "$db_path" ]]; then
  echo "找不到 PaperMind 配置数据库：$db_path" >&2
  exit 1
fi

# 字段以 ASCII Unit Separator 分隔，避免 base URL 中的常见字符产生歧义。
profile="$({ sqlite3 -separator $'\x1f' "$db_path" "
  SELECT json_extract(json_each.value, '\$.provider'),
         json_extract(json_each.value, '\$.model'),
         json_extract(json_each.value, '\$.baseUrl'),
         json_extract(json_each.value, '\$.apiKey')
  FROM settings, json_each(settings.value)
  WHERE settings.key = 'llm_profiles'
    AND json_extract(json_each.value, '\$.name') = '$profile_name';
"; })"

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

# 单一 QASPER 全集保证 --out 的文件名严格为 qa-full-{algorithm}.json。
for algorithm in bm25 jaccard cosine; do
  echo "[$(date '+%F %T')] 开始 rag-$algorithm"
  npm run bench -- --task qa --dataset qasper --config "rag-$algorithm" --out "$results_dir/qa-full-$algorithm.json"
  echo "[$(date '+%F %T')] 完成 rag-$algorithm"
done
