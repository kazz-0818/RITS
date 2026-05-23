# LLM 使用率 — RITS 受信 API（実装済み）

## エージェントからの送信

```
POST /admin/usage
x-admin-api-key: <RITS の ADMIN_API_KEY と同値>
Content-Type: application/json

{
  "agent_name": "NEAR",
  "model": "gpt-4o-mini",
  "prompt_tokens": 120,
  "completion_tokens": 45,
  "source": "intent_classifier",
  "total_tokens": 165,
  "metadata": {}
}
```

NEAR / SERA / IRIE / LRAM は `recordLlmUsage()` 内で、次が揃っているとき自動 POST します。

- `VERIORA_RITS_BASE_URL`（例: `https://<rits>.onrender.com`）
- `VERIORA_RITS_ADMIN_API_KEY`（RITS の `ADMIN_API_KEY` と同じ）

## 集計確認（手動）

```
GET /admin/usage/summary?date=2026-05-21
x-admin-api-key: ...
```

## DB

migration `017_llm_usage_events.sql` → `public.llm_usage_events`

Supabase SQL Editor で適用してください。

## 日次レポートへの反映

- `POST /admin/reports/daily` 生成時に LLM 集計をプロンプトへ同梱
- LINE push / 「日次レポート」コマンドの本文末尾に **■ LLM 使用量** セクション（JST 暦日ベースのトークン占有率）

## 稼働率の意味

上限クォータは未設定のため、**その日の総トークンに対するエージェント別シェア（%）** を「稼働率」として表示します。
