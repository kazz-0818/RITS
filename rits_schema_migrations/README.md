# rits_schema_migrations

RITS 用 Postgres（Supabase `public`）の **番号付き migration** です。NEAR の `near_schema_migrations` と同じ運用イメージです。

## 適用順（必ず昇順）

| ファイル | 内容 |
|----------|------|
| `001_extension_pgcrypto.sql` | 拡張 `pgcrypto` |
| `002_create_tables.sql` | 6 テーブル + index |
| `003_triggers_updated_at.sql` | `updated_at` トリガ |
| `004_seed_agent_profiles.sql` | NEAR / SERA / LIRA / RITS 初期データ |
| `005_daily_reports_owner_line_pushed.sql` | オーナー日次 LINE push 済み時刻（任意・二重送信防止） |

## Supabase SQL Editor での手順

1. **001 → 002 → 003 → 004**（必須）、必要なら **005** を順に **New query** に貼って **Run**（1 本にまとめない）
2. チャットの `...` や `curl` は **貼らない**

## 一括コピー（ターミナル）

```bash
cd /Users/akaikazufumi/Downloads/System/RITS
cat rits_schema_migrations/00*.sql | pbcopy   # macOS: クリップボードへ
```

貼り付けて 1 回 Run してもよいです（中身は分割ファイルと同じ）。

## 冪等性

`IF NOT EXISTS` / `ON CONFLICT` を使っているため、**既に適用済みでも再実行して問題ありません**。

## 新規 migration の追加

- 次の番号でファイルを追加（例: `005_add_xxx.sql`）
- **既存ファイルの中身は書き換えない**（履歴として残す）
