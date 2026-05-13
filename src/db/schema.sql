-- RITS — Supabase (Postgres) schema
-- Apply in Supabase SQL Editor or via migration tooling.
--
-- 貼り付け方: このファイルの「先頭から最終行まで」をそのまま1本のクエリとして実行してください。
-- チャットや説明文に混ざった「// ...」行は SQL ではないためエラーになります（貼り付けないでください）。

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- agent_profiles
-- ---------------------------------------------------------------------------
create table if not exists public.agent_profiles (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null unique,
  display_name text,
  role text not null,
  allowed_scope text,
  forbidden_scope text,
  tone text,
  evaluation_rules text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_agent_profiles_active on public.agent_profiles (is_active);

-- ---------------------------------------------------------------------------
-- agent_logs
-- ---------------------------------------------------------------------------
create table if not exists public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  user_message text,
  agent_reply text,
  intent text,
  confidence numeric,
  source text default 'line',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_agent_logs_agent_created on public.agent_logs (agent_name, created_at desc);

-- ---------------------------------------------------------------------------
-- agent_audits
-- ---------------------------------------------------------------------------
create table if not exists public.agent_audits (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  target_log_id uuid references public.agent_logs (id) on delete set null,
  score integer,
  grade text,
  issue_type text,
  risk_level text,
  summary text,
  evidence text,
  improvement text,
  cursor_instruction text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_agent_audits_agent_created on public.agent_audits (agent_name, created_at desc);

-- ---------------------------------------------------------------------------
-- unsupported_requests
-- ---------------------------------------------------------------------------
create table if not exists public.unsupported_requests (
  id uuid primary key default gen_random_uuid(),
  agent_name text,
  request_text text not null,
  reason text,
  suggested_feature text,
  priority text default 'medium',
  status text default 'open',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_unsupported_open_priority on public.unsupported_requests (status, priority, created_at desc);

-- ---------------------------------------------------------------------------
-- system_errors
-- ---------------------------------------------------------------------------
create table if not exists public.system_errors (
  id uuid primary key default gen_random_uuid(),
  source text,
  error_message text not null,
  stack_trace text,
  severity text default 'medium',
  resolved boolean default false,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_system_errors_created on public.system_errors (created_at desc);

-- ---------------------------------------------------------------------------
-- daily_reports
-- ---------------------------------------------------------------------------
create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  summary text,
  near_summary text,
  sera_summary text,
  lira_summary text,
  total_score integer,
  priority_issues text,
  cursor_instruction text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_agent_profiles_updated on public.agent_profiles;
create trigger trg_agent_profiles_updated
before update on public.agent_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_unsupported_requests_updated on public.unsupported_requests;
create trigger trg_unsupported_requests_updated
before update on public.unsupported_requests
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: agent_profiles (NEAR / SERA / LIRA / RITS)
-- ---------------------------------------------------------------------------
insert into public.agent_profiles (agent_name, display_name, role, allowed_scope, forbidden_scope, tone, evaluation_rules, is_active)
values
(
  'NEAR',
  'NEAR',
  'AI秘書・実務受付・ユーザー対応・未対応リクエスト整理',
  '依頼受付、タスク整理、未対応機能の記録、オーナーへの報告、実務補佐',
  '根拠のない断定、勝手な実行、対応不能なことを可能と言い切ること',
  '冷静・簡潔・実務寄り',
  '未対応の扱い、オーナー通知、過剰約束がないかを重点的に見る。',
  true
),
(
  'SERA',
  'SERA',
  '分析・SNS/広告/Instagram/データ確認系の補佐AI',
  'SNS分析、広告分析、Instagram関連確認、投稿・数値・データの整理',
  '外部確認できていない情報の断定、投稿リンクの捏造、根拠不明の数値提示',
  '分析寄り・根拠提示を重視',
  '外部確認不能時の断定、URL/数値の根拠、質問意図とのズレを重点的に見る。',
  true
),
(
  'LIRA',
  'LIRA',
  '経理担当AI。BRANDVOXまわりの売上・経費・利益・入金連絡を担当',
  '売上、経費、利益、入金確認、経理管理、スプレッドシート上の数値整理',
  '根拠のない金額提示、税務・法務の断定、経理外の意思決定',
  '慎重・数値の出所を明確化',
  '金額・税務・法務の断定、データ接続不能時の曖昧さを重点的に見る。',
  true
),
(
  'RITS',
  'RITS',
  'AI人事。AIエージェントの監査・評価・配置・改善提案を担当',
  '会話監査、システムログ監査、品質評価、改善提案、Cursor向け指示文作成',
  '人間の採用担当として振る舞うこと、経理担当として振る舞うこと、NEAR/SERA/LIRAの役割を奪うこと',
  '冷静・観察的・改善まで提示',
  '役割混同、断定の過多、根拠不足、改善の具体性を重点的に見る。',
  true
)
on conflict (agent_name) do update set
  display_name = excluded.display_name,
  role = excluded.role,
  allowed_scope = excluded.allowed_scope,
  forbidden_scope = excluded.forbidden_scope,
  tone = excluded.tone,
  evaluation_rules = excluded.evaluation_rules,
  is_active = excluded.is_active,
  updated_at = now();
