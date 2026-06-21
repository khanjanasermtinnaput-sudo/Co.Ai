#!/usr/bin/env bash
# Local v2 preview driver: boots the server with COAGENTIX_V2=1, registers/logs in
# a local user, stores the provider key from .env (if present, encrypted via the
# real route), then POSTs /v2/run and streams the SSE. The raw key is read from
# the environment and never printed.
set -uo pipefail
cd "$(dirname "$0")/.."   # tmap-v2/

PORT="${PORT:-8787}"
BASE="http://localhost:$PORT"
USER="v2tester"
PIN="12345"
TASK="${1:-Build a small TypeScript function add(a,b) with a Jest test}"

# Load .env so we can read the raw key locally (values never echoed).
set -a; [ -f .env ] && . ./.env; set +a

# Detect which provider key (if any) is present in the env.
PROVIDER=""; KEY=""
if [ -n "${OPENROUTER_API_KEY:-}" ]; then PROVIDER="openrouter"; KEY="$OPENROUTER_API_KEY";
elif [ -n "${DEEPSEEK_API_KEY:-}" ]; then PROVIDER="deepseek"; KEY="$DEEPSEEK_API_KEY";
elif [ -n "${GEMINI_API_KEY:-}" ]; then PROVIDER="gemini"; KEY="$GEMINI_API_KEY";
elif [ -n "${QWEN_API_KEY:-}" ]; then PROVIDER="qwen"; KEY="$QWEN_API_KEY";
elif [ -n "${LLAMA_API_KEY:-}" ]; then PROVIDER="llama"; KEY="$LLAMA_API_KEY"; fi

echo "==> freeing port $PORT if held by a stale server"
powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 || true
sleep 1

echo "==> starting server (COAGENTIX_V2=${COAGENTIX_V2:-unset}) on :$PORT"
npx tsx src/server/index.ts >/tmp/v2-server.log 2>&1 &
SRV=$!
# Kill the tsx wrapper AND whatever it spawned on PORT (tsx forks a child node).
cleanup() {
  kill $SRV 2>/dev/null
  powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> waiting for /v1/health"
for i in $(seq 1 40); do
  if curl -fsS "$BASE/v1/health" >/dev/null 2>&1; then echo "   up"; break; fi
  if ! kill -0 $SRV 2>/dev/null; then echo "   server died — log:"; tail -20 /tmp/v2-server.log; exit 1; fi
  sleep 0.5
done

extract_token() { grep -oE '"token":"[^"]+"' | head -1 | sed -E 's/"token":"([^"]+)"/\1/'; }

echo "==> register/login $USER"
REG=$(curl -fsS -X POST "$BASE/v1/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"pin\":\"$PIN\"}" 2>/dev/null || true)
TOKEN=$(printf '%s' "$REG" | extract_token)
if [ -z "$TOKEN" ]; then
  LOG=$(curl -fsS -X POST "$BASE/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER\",\"pin\":\"$PIN\"}")
  TOKEN=$(printf '%s' "$LOG" | extract_token)
fi
[ -n "$TOKEN" ] && echo "   got JWT (len ${#TOKEN})" || { echo "   FAILED to get token"; exit 1; }

if [ -n "$KEY" ]; then
  echo "==> storing key for provider=$PROVIDER (value hidden)"
  curl -fsS -X PUT "$BASE/v1/me/keys" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"provider\":\"$PROVIDER\",\"key\":\"$KEY\"}" | sed -E 's/("key"[^,]*)//'
  echo
else
  echo "==> NO key in .env — this is a WIRING CHECK ONLY (no real LLM call)"
fi

echo "==> POST /v2/run (SSE)"
curl -N --max-time 180 -X POST "$BASE/v2/run" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"task\":\"$TASK\"}"
echo
echo "==> done"
