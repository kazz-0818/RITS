#!/usr/bin/env bash
# Render 本番を直接叩いて日次監査を LINE_OWNER_USER_ID へ push する
# 使い方:
#   export ADMIN_API_KEY='（Render の rits / rits-secrets と同じ値）'
#   ./scripts/render-push-daily-owner.sh
#   ./scripts/render-push-daily-owner.sh --force

set -euo pipefail

RENDER_URL="${RITS_RENDER_URL:-https://rits-gj2m.onrender.com}"
RENDER_URL="${RENDER_URL%/}"
FORCE="${1:-}"

if [[ -z "${ADMIN_API_KEY:-}" ]]; then
  echo "ADMIN_API_KEY が未設定です（Render Dashboard → rits → Environment）" >&2
  exit 1
fi

BODY='{"force":false}'
if [[ "$FORCE" == "--force" ]]; then
  BODY='{"force":true}'
fi

echo "POST ${RENDER_URL}/admin/reports/daily/push-owner"
curl -sS -w "\nHTTP:%{http_code}\n" -X POST "${RENDER_URL}/admin/reports/daily/push-owner" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: ${ADMIN_API_KEY}" \
  -d "${BODY}"
