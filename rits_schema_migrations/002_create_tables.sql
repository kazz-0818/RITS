-- rits_schema_migrations 002 — tables + indexes

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

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  summary text,
  near_summary text,
  sera_summary text,
  irie_summary text,
  total_score integer,
  priority_issues text,
  cursor_instruction text,
  created_at timestamptz default now()
);
