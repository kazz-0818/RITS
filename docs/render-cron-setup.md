# Render Cron（日次 LINE push）セットアップ

毎日 **JST 9:00**（UTC `0 0 * * *`）に、本番 URL を直接叩いて `/admin/reports/daily/push-owner` を実行します。

## 方法 A: Dashboard で Cron を新規作成（いま Cron が無い場合）

1. [Render Dashboard](https://dashboard.render.com/) → **New +** → **Cron Job**
2. 設定:

| 項目 | 値 |
|------|-----|
| Name | `rits-daily-owner-push` |
| Repository | `kazz-0818/RITS` |
| Branch | `main` |
| Region | Oregon |
| Runtime | Node |
| Build Command | `NPM_CONFIG_PRODUCTION=false npm install && npm run build`（またはリポジトリの `.npmrc` の `production=false` を main に含める） |
| Start Command | `node dist/scripts/cronDailyOwnerPush.js` |
| Schedule | `0 0 * * *` |

3. **Environment Variables**（Web の `rits` と同じ `ADMIN_API_KEY` を必ず設定）:

| Key | Value |
|-----|--------|
| `ADMIN_API_KEY` | Web サービス `rits` と同じ |
| `RITS_RENDER_URL` | `https://rits-gj2m.onrender.com` |
| `APP_BASE_URL` | `https://rits-gj2m.onrender.com` |
| `NODE_ENV` | `production` |

4. **Create Cron Job** → 一度 **Manual Run** でログが `status 200` になるか確認

## 方法 B: Blueprint（`render.yaml`）を再適用

リポジトリの [`render.yaml`](../render.yaml) に Cron 定義済み。Dashboard で Blueprint を Sync すると `rits-daily-owner-push` が作られます。

## 環境変数を .env から一括反映（API）

1. [Render API Keys](https://dashboard.render.com/u/settings#api-keys) でキーを発行
2. リポジトリルートで:

```bash
export RENDER_API_KEY='rnd_...'
chmod +x scripts/render-sync-env.sh
./scripts/render-sync-env.sh
```

3. Dashboard で **Save, rebuild, and deploy**（Web と Cron の両方）

Web には `NODE_ENV=production` と `DAILY_OWNER_PUSH_ENABLED=false` を設定。Cron には `ADMIN_API_KEY`（Web と同じ）、`RITS_RENDER_URL`、`APP_BASE_URL` を設定。

## 手動で Render を直接叩く（テスト）

```bash
export ADMIN_API_KEY='（Render の値）'
npm run render:push-daily-owner
# 再送
npm run render:push-daily-owner -- --force
```

または:

```bash
curl -sS -X POST "https://rits-gj2m.onrender.com/admin/reports/daily/push-owner" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -d '{"force":false}'
```

## 各部署（NEAR / SERA / IRIE / LRAM）の env

日次レポートの **会話ログ** と **LLM 使用量** を RITS に集約するには、各 Render サービスに次を追加（値は RITS Web の `ADMIN_API_KEY` と同じキーを使う）:

| Key | 例 |
|-----|-----|
| `VERIORA_RITS_BASE_URL` | `https://rits-gj2m.onrender.com` |
| `VERIORA_RITS_ADMIN_API_KEY` | （RITS `ADMIN_API_KEY` と同値） |

- 会話: LINE 返信時に `POST /admin/logs`（コード: 各リポ `ritsIngest` / LIRA `rits_ingest.py`）
- グループ傍受: ボット未応答のグループ発言は `intent=group_observe` で転送（既定 ON）。日次 LINE に「グループ傍受」節と応答/傍受の内訳を載せる
- RITS 自身の LINE: `agent_logs` に `agent_name=RITS` で記録（日次の RITS（人事LINE）行）
- LLM: 既存 `recordLlmUsage` → `POST /admin/usage`（migration `017_llm_usage_events` 適用済みであること）

## 前提

- Web サービス `rits` に `LINE_OWNER_USER_ID` が設定されていること
- `POST /admin/reports/daily/push-owner` がデプロイ済みであること
