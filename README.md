# RITS（リツ）

RITSは「人間の人事」ではなく、稼働中のAIエージェント（NEAR / SERA / LIRA 等）を**監査・評価・改善提案**するための **AI人事** です。

## 設計方針（重要）

- **正式な記録台帳は Supabase**（`agent_logs` / `agent_audits` / `daily_reports` など）。
- **OpenAIは無状態の判断・文章生成エンジン**として利用し、OpenAI側の会話履歴やダッシュボードログに依存しません。
- 監査・レポート生成では、**Supabaseから取得した最小限のログ/監査抜粋**だけをプロンプトに渡します。

## 使用技術

- Node.js 20+
- TypeScript
- Hono + `@hono/node-server`
- Supabase JS（service role）
- OpenAI SDK
- LINE Messaging API
- Render（`render.yaml`）

## Render へデプロイ（このリポジトリ）

リポジトリ: `https://github.com/kazz-0818/RITS`

1. 次のいずれかで Blueprint 作成フローを開きます（**repo を明示**）。  
   - [Deploy to Render（このリポジトリを指定）](https://render.com/deploy?repo=https://github.com/kazz-0818/RITS)
2. GitHub 連携を承認し、ルートの [`render.yaml`](render.yaml) を読み込ませます。
3. **プライベートリポジトリ**の場合は [Render GitHub App](https://github.com/apps/render) を当該リポジトリにインストールしてください。
4. ダッシュボードで `sync: false` のシークレット系環境変数（`OPENAI_API_KEY` 等）を設定し、デプロイ完了後に `APP_BASE_URL` を実サービスURLに更新してください。

## セットアップ

```bash
cd /Users/akaikazufumi/Downloads/System/RITS
npm install
npm run dev
```

## `.env` 設定

プロジェクト直下の [`.env`](.env) を編集します（**Gitにコミットしないでください**）。

| 変数 | 説明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI APIキー |
| `OPENAI_MODEL` | 既定: `gpt-4.1-mini` |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINEチャネルアクセストークン |
| `LINE_CHANNEL_SECRET` | LINEチャネルシークレット |
| `LINE_OWNER_USER_ID` | オーナーのLINEユーザーID（任意運用） |
| `SUPABASE_URL` | `https://` で始まる Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `ADMIN_API_KEY` | `/admin` 系API保護用の共有鍵 |
| `APP_BASE_URL` | 例: `https://<your-service>.onrender.com` |
| `NODE_ENV` | `development` / `production` |
| `PORT` | 例: `3000` |

補足:

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` に **「ここに…」の日本語プレースホルダーが残っている間**は、Supabase接続を作らず **`/admin` と `/webhook/line` は 503** になります（`/health` は起動確認用に通します）。

## Supabase: `schema.sql` の適用

SQLは [`src/db/schema.sql`](src/db/schema.sql) にあります。

1. Supabase Dashboard → SQL Editor
2. `schema.sql` の内容を貼り付けて実行

テーブル:

- `agent_profiles`（初期データ込み）
- `agent_logs`
- `agent_audits`
- `unsupported_requests`
- `system_errors`
- `daily_reports`（`report_date` は UNIQUE）

## LINE Webhook 設定

1. LINE Developers でチャネルを作成
2. Webhook URL を `https://<APP_BASE_URLのホスト>/webhook/line` に設定  
   例: `https://your-service.onrender.com/webhook/line`
3. Webhookを有効化

ローカル検証は ngrok 等で公開URLを用意してください。

## Render デプロイ（詳細）

上記の **[Render へデプロイ（このリポジトリ）](#render-へデプロイこのリポジトリ)** を参照してください（Blueprint / 環境変数）。

## ログ投入API（外部エージェント → RITS）

`POST /admin/logs`

ヘッダー:

- `x-admin-api-key: <ADMIN_API_KEY>`

例:

```bash
curl -sS -X POST "$APP_BASE_URL/admin/logs" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -d '{
    "agent_name":"SERA",
    "user_message":"投稿リンクは出せる？",
    "agent_reply":"（応答）",
    "intent":"instagram_post_link",
    "confidence":0.72,
    "source":"line",
    "metadata":{}
  }'
```

## 監査実行API

`POST /admin/audit/run`

```bash
curl -sS -X POST "$APP_BASE_URL/admin/audit/run" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -d '{"agent_name":"SERA","limit":20}'
```

## 日次レポート生成API

`POST /admin/reports/daily`

```bash
curl -sS -X POST "$APP_BASE_URL/admin/reports/daily" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -d '{}'
```

## LINEコマンド（例）

- **今日の監査 / 日次レポート**: `リツ、今日の監査` / `日次レポート` など  
  - `daily_reports`（JSTの暦日 `report_date`）があればそれを返し、なければ直近24時間の集計から生成して保存します。
- **AI別のミス/改善点**: `リツ、SERAのミス見せて` / `NEARの改善点ある？` など
- **未対応リクエスト**: `未対応リクエスト見せて` / `できてないこと一覧` など
- **Cursor指示文**: `SERAの改善をCursorに投げる文作って` など（高リスク監査を優先して参照）

## テストログ投入（seed）

Supabaseの `.env` を実値にした上で:

```bash
npm run seed:test-logs
```

## 本番運用の注意（RLS）

このMVPは **サーバーが service role を保持**する前提です。本番では **RLS / 権限分離 / anon keyの不使用** などを検討してください。

## 今後の拡張案（コード内TODO）

GitHub / Sentry / Langfuse / Renderログ取得 / Edge Functions化 / 定期日次監査 / Cursor自動改善 / Owner承認 / スコア推移グラフ / 管理画面 など。

## 開発コマンド

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run seed:test-logs
```

## ローカル動作確認（最小）

```bash
npm run build
node dist/index.js
curl -sS http://127.0.0.1:3000/health
```

## テスト用curl（まとめ）

```bash
export APP_BASE_URL=http://127.0.0.1:3000
export ADMIN_API_KEY="（.envの値）"

curl -sS "$APP_BASE_URL/health"

curl -i -sS -X POST "$APP_BASE_URL/admin/logs" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -d '{"agent_name":"NEAR","user_message":"ping","agent_reply":"pong","source":"curl"}'

curl -i -sS -X POST "$APP_BASE_URL/admin/audit/run" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -d '{"agent_name":"SERA","limit":5}'

curl -i -sS -X POST "$APP_BASE_URL/admin/reports/daily" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -d '{}'
```
