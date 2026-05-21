-- rits_schema_migrations 005 — オーナーへの日次LINE push 済み時刻（同日の二重送信防止）

alter table public.daily_reports
  add column if not exists owner_line_pushed_at timestamptz;
