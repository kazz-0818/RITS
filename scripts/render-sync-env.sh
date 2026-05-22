#!/usr/bin/env bash
# Render の Web (rits) と Cron (rits-daily-owner-push) に .env の値をマージする。
# 使い方: RENDER_API_KEY='rnd_...' ./scripts/render-sync-env.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${RENDER_API_KEY:-}" ]]; then
  echo "RENDER_API_KEY が未設定です。Dashboard → Account Settings → API Keys で発行してください。" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo ".env がありません" >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

WEB_ID="${RENDER_WEB_SERVICE_ID:-srv-d829vcd7vvec73b48org}"
CRON_ID="${RENDER_CRON_SERVICE_ID:-crn-d87u9k6q1p3s73fmutk0}"

APP_BASE_URL="${APP_BASE_URL:-https://rits-gj2m.onrender.com}"
RITS_RENDER_URL="${RITS_RENDER_URL:-https://rits-gj2m.onrender.com}"

put_env() {
  local sid="$1"
  shift
  local body count
  body="$(python3 -c '
import json, sys
pairs = []
for arg in sys.argv[1:]:
    k, _, v = arg.partition("=")
    if v:
        pairs.append({"key": k, "value": v})
print(json.dumps(pairs))
' "$@")"
  count="$(python3 -c 'import json,sys; print(len(json.loads(sys.argv[1])))' "$body")"
  echo "→ PUT env-vars serviceId=$sid ($count keys)"
  curl -sS -X PUT "https://api.render.com/v1/services/${sid}/env-vars" \
    -H "Authorization: Bearer ${RENDER_API_KEY}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$body" \
    -w "\nHTTP %{http_code}\n"
}

# Web
put_env "$WEB_ID" \
  "ADMIN_API_KEY=${ADMIN_API_KEY}" \
  "OPENAI_API_KEY=${OPENAI_API_KEY}" \
  "OPENAI_MODEL=${OPENAI_MODEL:-gpt-4.1-mini}" \
  "LINE_CHANNEL_ACCESS_TOKEN=${LINE_CHANNEL_ACCESS_TOKEN}" \
  "LINE_CHANNEL_SECRET=${LINE_CHANNEL_SECRET}" \
  "LINE_OWNER_USER_ID=${LINE_OWNER_USER_ID}" \
  "SUPABASE_URL=${SUPABASE_URL}" \
  "SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}" \
  "APP_BASE_URL=${APP_BASE_URL}" \
  "NODE_ENV=production" \
  "DAILY_OWNER_PUSH_ENABLED=false" \
  "DAILY_OWNER_PUSH_TIME_JST=${DAILY_OWNER_PUSH_TIME_JST:-09:00}"

# Cron（ADMIN_API_KEY は Web と同一）
put_env "$CRON_ID" \
  "ADMIN_API_KEY=${ADMIN_API_KEY}" \
  "RITS_RENDER_URL=${RITS_RENDER_URL}" \
  "APP_BASE_URL=${APP_BASE_URL}" \
  "NODE_ENV=production"

echo "完了。Dashboard で再デプロイするか:"
echo "  render deploys create ${WEB_ID} --confirm"
echo "  render deploys create ${CRON_ID} --confirm"
