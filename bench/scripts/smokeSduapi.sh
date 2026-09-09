#!/bin/zsh
# sduapi 端点连通性 smoke：按 bench provider=anthropic 的请求形状（x-api-key + /chat/completions）
set -e
source "$(dirname "$0")/../cache/bench-env-sduapi.sh"
curl -sS -m 60 -X POST "$BENCH_LLM_BASE_URL/chat/completions" \
  -H "x-api-key: $BENCH_LLM_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$BENCH_LLM_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: OK\"}],\"temperature\":0,\"max_tokens\":16}" | head -c 600
echo
