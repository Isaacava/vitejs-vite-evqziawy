create table if not exists public.execution_capital_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  agent_id uuid references public.marketplace_agents(id),
  requester_wallet text not null,
  user_execution_wallet text,
  agent_session_key text,
  session_key_id text,
  capital_requested numeric(38, 18) not null check (capital_requested > 0),
  capital_token text not null,
  purpose text not null,
  requested_duration_seconds integer not null check (requested_duration_seconds > 0),
  wallet_provider text not null check (wallet_provider = 'altana'),
  authorization_model text not null check (authorization_model = 'scoped_session'),
  capital_authorized numeric(38, 18),
  spend_cap numeric(38, 18),
  call_allowlist jsonb not null default '[]'::jsonb,
  session_expires_at timestamptz,
  capital_deployed numeric(38, 18),
  capital_returned numeric(38, 18),
  ending_assets jsonb,
  realized_pnl numeric(38, 18),
  unrealized_pnl numeric(38, 18),
  status text not null default 'requested' check (status in ('requested','authorized','active','exit_pending','settled','revoked','expired')),
  authorization_verified_at timestamptz,
  session_grant_tx_hash text,
  session_revoke_tx_hash text,
  evidence jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  authorized_at timestamptz,
  activated_at timestamptz,
  exit_pending_at timestamptz,
  settled_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint execution_capital_requests_one_per_job unique (job_id)
);

create index if not exists execution_capital_requests_job_idx on public.execution_capital_requests(job_id);
create index if not exists execution_capital_requests_status_idx on public.execution_capital_requests(status);
create index if not exists execution_capital_requests_session_idx on public.execution_capital_requests(session_key_id) where session_key_id is not null;

create or replace function public.touch_execution_capital_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists execution_capital_requests_touch_updated_at on public.execution_capital_requests;
create trigger execution_capital_requests_touch_updated_at
before update on public.execution_capital_requests
for each row execute function public.touch_execution_capital_requests_updated_at();

alter table public.execution_capital_requests enable row level security;

drop policy if exists execution_capital_requests_owner_select on public.execution_capital_requests;
create policy execution_capital_requests_owner_select
on public.execution_capital_requests
for select
using (
  exists (
    select 1
    from public.jobs j
    join public.users u on u.wallet_address is not null and lower(u.wallet_address) = lower(j.client_wallet)
    where j.id = execution_capital_requests.job_id
      and u.id = auth.uid()
  )
);

comment on table public.execution_capital_requests is
  'Execution capital requests are separate from ERC-8183 job payment. Altana-only scoped sessions use the user-owned execution wallet; unobserved capital/PnL stays null.';
