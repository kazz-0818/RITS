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
| Build Command | `npm install && npm run build` |
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

## 前提

- Web サービス `rits` に `LINE_OWNER_USER_ID` が設定されていること
- `POST /admin/reports/daily/push-owner` がデプロイ済みであること
