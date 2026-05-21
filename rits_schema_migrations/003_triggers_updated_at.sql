-- rits_schema_migrations 003 — updated_at triggers

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
