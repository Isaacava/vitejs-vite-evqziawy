create table if not exists public.agent_health_checks (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  endpoint_url text,
  status text not null check (status in ('online','degraded','offline','unknown')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  status_code integer,
  source text not null default 'runtime',
  checked_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists agent_health_checks_agent_checked_idx
  on public.agent_health_checks(agent_id, checked_at desc);

alter table public.agent_health_checks enable row level security;

create policy "authenticated users can view agent health"
  on public.agent_health_checks
  for select
  to authenticated
  using (true);
