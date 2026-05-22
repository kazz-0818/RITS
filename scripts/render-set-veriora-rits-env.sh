#!/usr/bin/env bash
# 各部署 Web サービスに VERIORA_RITS_* を設定（既存 env は .env から丸ごと復元してからマージ）。
# 使い方: RENDER_API_KEY は ~/.render/cli.yaml または環境変数
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${RENDER_API_KEY:-}" ]]; then
  RENDER_API_KEY="$(grep -E '^\s+key:' "${HOME}/.render/cli.yaml" 2>/dev/null | head -1 | sed 's/.*key: //' || true)"
fi
if [[ -z "${RENDER_API_KEY:-}" ]]; then
  echo "RENDER_API_KEY が未設定です" >&2
  exit 1
fi

RITS_WEB_ID="${RENDER_RITS_WEB_SERVICE_ID:-srv-d829vcd7vvec73b48org}"
BASE_URL="${VERIORA_RITS_BASE_URL:-https://rits-gj2m.onrender.com}"

RITS_ADMIN="$(curl -sS "https://api.render.com/v1/services/${RITS_WEB_ID}/env-vars?limit=100" \
  -H "Authorization: Bearer ${RENDER_API_KEY}" \
  -H "Accept: application/json" | python3 -c "
import json,sys
for item in json.load(sys.stdin):
    ev=item.get('envVar',item)
    if ev.get('key')=='ADMIN_API_KEY':
        print(ev.get('value','')); break
")"

if [[ -z "${RITS_ADMIN}" ]]; then
  echo "RITS の ADMIN_API_KEY を Render から取得できませんでした" >&2
  exit 1
fi

service_id() {
  case "$1" in
    NEAR) echo "srv-d827s21j2pic73b3457g" ;;
    SERA) echo "srv-d827p4mgvqtc73denm60" ;;
    LIRA) echo "srv-d829fi3eo5us7386o5cg" ;;
    LRAM) echo "srv-d879fflckfvc73a1fm90" ;;
    *) return 1 ;;
  esac
}

env_file_for() {
  case "$1" in
    NEAR) echo "${NEAR_ENV_FILE:-$ROOT/../NEAR/.env}" ;;
    SERA) echo "${SERA_ENV_FILE:-$ROOT/../SERA/.env}" ;;
    LIRA) echo "${LIRA_ENV_FILE:-$ROOT/../LIRA/.env}" ;;
    LRAM) echo "${LRAM_ENV_FILE:-$ROOT/../LRAM/.env}" ;;
    *) return 1 ;;
  esac
}

put_env_from_file() {
  local name="$1"
  local sid="$2"
  local env_file="$3"
  if [[ ! -f "$env_file" ]]; then
    echo "[$name] skip: $env_file がありません" >&2
    return 1
  fi
  local body
  body="$(VERIORA_RITS_BASE_URL="$BASE_URL" VERIORA_RITS_ADMIN_API_KEY="$RITS_ADMIN" \
    python3 - "$env_file" <<'PY'
import json, os, sys
from pathlib import Path

path = Path(sys.argv[1])
out: dict[str, str] = {}
for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("export "):
        line = line[7:].strip()
    if "=" not in line:
        continue
    k, _, v = line.partition("=")
    k, v = k.strip(), v.strip()
    if (len(v) >= 2) and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
        v = v[1:-1]
    if k and v:
        out[k] = v
out["VERIORA_RITS_BASE_URL"] = os.environ["VERIORA_RITS_BASE_URL"]
out["VERIORA_RITS_ADMIN_API_KEY"] = os.environ["VERIORA_RITS_ADMIN_API_KEY"]
if "NODE_ENV" not in out:
    out["NODE_ENV"] = "production"
print(json.dumps([{"key": k, "value": v} for k, v in sorted(out.items())]))
PY
)"
  local code
  code="$(curl -sS -o /tmp/render_put_env.json -w "%{http_code}" -X PUT \
    "https://api.render.com/v1/services/${sid}/env-vars" \
    -H "Authorization: Bearer ${RENDER_API_KEY}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$body")"
  local count
  count="$(python3 -c 'import json; print(len(json.loads(open("/tmp/render_put_env.json"))))' 2>/dev/null || echo "?")"
  echo "[$name] PUT env-vars HTTP $code (${count} keys from $(basename "$env_file"))"
}

for name in NEAR SERA LIRA LRAM; do
  put_env_from_file "$name" "$(service_id "$name")" "$(env_file_for "$name")"
done

echo "完了。各サービスを再デプロイしてください:"
for name in NEAR SERA LIRA LRAM; do
  echo "  render deploys create $(service_id "$name") --confirm"
done
