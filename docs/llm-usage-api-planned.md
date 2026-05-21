# LLM 使用率 API（予定・RITS 側）

## エージェントからの受信（未実装）

```
POST /admin/usage
x-admin-api-key: <ADMIN_API_KEY と同値>
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

## エージェント側の準備状況

NEAR / SERA / LIRA / LRAM は `recordLlmUsage()` 実装済み。  
`VERIORA_RITS_BASE_URL` + `VERIORA_RITS_ADMIN_API_KEY` 未設定時は **送信しない**（debug ログのみ）。

## 実装予定（RITS）

1. `POST /admin/usage` — 行を `public.llm_usage_events` 等へ INSERT
2. 日次集計 cron — agent_name × model 別サマリ
3. 管理画面または日次レポートへの掲載
