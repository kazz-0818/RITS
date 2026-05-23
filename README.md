# RITS（リツ）

## Veriora 組織OS

このリポジトリは **Veriora** の AI 人事部エージェント（**RITS**）です。組織共通の規約・registry・手順は [`AGENTS.md`](AGENTS.md) と [`docs/veriora-architecture.md`](docs/veriora-architecture.md) を参照してください。環境変数テンプレートは [`.env.example`](.env.example) です。

RITSは「人間の人事」ではなく、稼働中のAIエージェント（NEAR / SERA / IRIE 等）を**監査・評価・改善提案**するための **AI人事** です。

## 組織内の役割（Veriora）

| 部署 | 役割 | 監査との関係 |
|------|------|----------------|
| **RITS** | AI人事部 — 会話品質・役割遵守・**組織横断の整合性監査** | **監査の実施者**。レポートは `daily_reports` / [`docs/veriora-consistency-audit.md`](docs/veriora-consistency-audit.md) |
| **NEAR** | 秘書部 — 総合窓口・タスク整理・**LLM 能力が強い裏方** | handoff・オーケストレーション。**監査レポートの主体ではない** |
| SERA / IRIE / LRAM | 各業務部署 | RITS の**監査対象** |

設計・migration SQL・共有 `docs/` の物理的な正典は NEAR リポに集約されていることが多いが、**整合性の判定・優先度・改善指示は RITS** が行う（正典の置き場と監査主体は分離）。

## 設計方針（重要）

- **正式な記録台帳は Supabase**（`agent_logs` / `agent_audits` / `daily_reports` など）。
- **OpenAIは無状態の判断・文章生成エンジン**として利用し、OpenAI側の会話履歴やダッシュボードログに依存しません。
- 監査・レポート生成では、**Supabaseから取得した最小限のログ/監査抜粋**だけをプロンプトに渡します。

**別ワークスペース向け（会話・LLM を日次に載せる / 二重 push 解消）**: [`docs/workspace-handoff-veriora-rits-pipeline.md`](docs/workspace-handoff-veriora-rits-pipeline.md)

## 使用技術

- Node.js 20+
- TypeScript
- Hono + `@hono/node-server`
- Supabase JS（service role）
- OpenAI SDK
- LINE Messaging API
- Render（`render.yaml`）

## Render デプロイが「Failed」になるとき

ビルドは通るが **起動直後に落ちる** 場合、Render の **Logs** に `[RITS] FATAL: 環境変数が不正` が出ていることが多いです。

| よくある原因 | 対処 |
|--------------|------|
| `APP_BASE_URL` に `.env.example` の日本語プレースホルダーが残っている | **削除**するか、実 URL（`https://rits-gj2m.onrender.com` 等）に差し替え。未設定なら Render の `RENDER_EXTERNAL_URL` に自動フォールバック（コード側でもプレースホルダーは無視） |
| `DATABASE_URL` に DB 接続文字列以外・誤った値 | **削除**するか、正しい `postgresql://...` のみ設定（任意。未設定で問題なし） |
| `SUPABASE_URL` に `postgresql://...` を入れている | Dashboard → API の **Project URL**（`https://xxxx.supabase.co`）に修正 |

起動後の確認: `GET https://<your-host>/health`（DB 非接触の即時 200。Render の healthCheckPath 向け）、詳細は `GET /health/supabase-tables`（`017` 未適用時は `supabase_optional_missing_tables` に `llm_usage_events` のみ出る想定）。

**`llm_usage_events` 未作成でデプロイが落ちた場合**（ログに `missing:["llm_usage_events"]` と `必須テーブル`）: 旧ビルドです。最新 `main` をデプロイするか、Supabase で `017_llm_usage_events.sql` を実行してください。

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

テンプレート: [`.env.example`](.env.example)。プロジェクト直下の [`.env`](.env) を編集します（**Gitにコミットしないでください**）。

| 変数 | 説明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI APIキー |
| `OPENAI_MODEL` | 既定: `gpt-4.1-mini` |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINEチャネルアクセストークン |
| `LINE_CHANNEL_SECRET` | LINEチャネルシークレット |
| `LINE_OWNER_USER_ID` | オーナーのLINEユーザーID（任意運用） |
| `SUPABASE_URL` | **API の Project URL**（`https://xxxx.supabase.co`）。**`postgresql://postgres...` の DB 接続文字列は不可**（`@supabase/supabase-js` 用） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `ADMIN_API_KEY` | `/admin` 系API保護用の共有鍵 |
| `APP_BASE_URL` | 例: `https://<your-service>.onrender.com` |
| `NODE_ENV` | `development` / `production` |
| `PORT` | 例: `3000` |

補足:

- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` に **「ここに…」の日本語プレースホルダーが残っている間**は、Supabase接続を作れません。**`/admin/*` は 503**、**`/webhook/line` は LINE 仕様のため 200 を返しますが、イベントは処理されません**（会話ログの保存・返信には実値が必要です）。**`GET /health`** では `supabase_ok` と失敗時のみ `supabase_hint`（秘密は出しません）を返すので、Render の変数名・**前後の引用符**・コピペ混入を切り分けできます。

## Supabase: `rits_schema_migrations` の適用

SQL はリポジトリ直下の [`rits_schema_migrations/`](rits_schema_migrations/) にあります（NEAR の `near_schema_migrations` と同様の番号付き運用）。

1. Supabase Dashboard → SQL Editor
2. **`001` → `002` → `003` → `004`** を順に貼り付けて実行（詳細は [`rits_schema_migrations/README.md`](rits_schema_migrations/README.md)）

一括で貼る場合（ターミナル）:

```bash
cat rits_schema_migrations/00*.sql | pbcopy
```

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

## LLM 使用率（各エージェント → RITS）

`POST /admin/usage`（NEAR / SERA / IRIE / LRAM が usage を送信。詳細は [`docs/llm-usage-api-planned.md`](docs/llm-usage-api-planned.md)）

```bash
curl -sS -X POST "$APP_BASE_URL/admin/usage" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -d '{"agent_name":"NEAR","model":"gpt-4o-mini","prompt_tokens":100,"completion_tokens":40,"source":"test"}'
```

集計プレビュー: `GET /admin/usage/summary?date=YYYY-MM-DD`（同日 JST 暦日）

**DB**: `rits_schema_migrations/017_llm_usage_events.sql` を Supabase に適用してください。

日次 LINE レポート・`POST /admin/reports/daily` の本文に **LLM トークン占有率** が含まれます。

## 日次レポート生成API

`POST /admin/reports/daily`

```bash
curl -sS -X POST "$APP_BASE_URL/admin/reports/daily" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -d '{}'
```

## オーナーへ日次監査を LINE push

`LINE_OWNER_USER_ID` が設定されているとき、サーバー起動中は **毎日 JST 09:00**（`DAILY_OWNER_PUSH_TIME_JST` で変更可）に、日次レポートを **push** します。同日の二重送信は `daily_reports.owner_line_pushed_at` で防ぎます（[`005_daily_reports_owner_line_pushed.sql`](rits_schema_migrations/005_daily_reports_owner_line_pushed.sql) を適用）。

手動で今すぐ送る:

```bash
curl -sS -X POST "$APP_BASE_URL/admin/reports/daily/push-owner" \
  -H "content-type: application/json" \
  -H "x-admin-api-key: $ADMIN_API_KEY" \
  -d '{"force":false}'
```

再送する場合は `"force":true`（本日分を再度 push）。

| 環境変数 | 説明 |
|----------|------|
| `LINE_OWNER_USER_ID` | push 先の LINE ユーザー ID |
| `DAILY_OWNER_PUSH_TIME_JST` | 送信時刻（既定 `09:00`、Asia/Tokyo） |
| `DAILY_OWNER_PUSH_ENABLED` | Render 本番は **未設定＝オフ**（Cron に任せる）。`true` のときだけ Web 内スケジューラも 9:00 push（Cron と二重になりやすい） |

Render 本番でも `LINE_OWNER_USER_ID` を Dashboard に設定してください。

### 無料 Web + 毎朝自動 push（Render Cron）

Web サービスがスリープするとアプリ内の 9:00 スケジューラは動きません。Cron **`rits-daily-owner-push`** が **毎日 UTC 0:00（JST 9:00）** に **本番 URL を直接** `POST /admin/reports/daily/push-owner` します。

**Cron 未作成の場合**: [`docs/render-cron-setup.md`](docs/render-cron-setup.md) の手順で Dashboard から作成してください。

**手動で Render を直接叩く**:

```bash
export ADMIN_API_KEY='（Render の rits と同じ値）'
npm run render:push-daily-owner
```

ローカル Web 向け（開発）:

```bash
export $(grep -v '^#' .env | grep -v '^$' | xargs)
APP_BASE_URL=http://127.0.0.1:3000 npm run cron:daily-owner-push
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
