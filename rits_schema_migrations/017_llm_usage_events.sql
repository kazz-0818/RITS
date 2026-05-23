-- rits_schema_migrations 017 — 各エージェントからの LLM usage イベント（日次集計用）

create table if not exists public.llm_usage_events (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  model text not null,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  source text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_llm_usage_events_created_at
  on public.llm_usage_events (created_at desc);

create index if not exists idx_llm_usage_events_agent_created
  on public.llm_usage_events (agent_name, created_at desc);

comment on table public.llm_usage_events is
  'NEAR/SERA/IRIE/LRAM 等が POST /admin/usage で送る OpenAI usage。日次レポートの LLM 稼働集計に使用。';

alter table public.llm_usage_events enable row level security;
