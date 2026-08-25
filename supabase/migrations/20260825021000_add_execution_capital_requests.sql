create table if not exists public.execution_capital_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  requester_wallet text not null,
  user_execution_wallet text,
  agent_session_key text,
  session_key_id text,
  wallet_provider text not null default 'altana' check (wallet_provider = 'altana'),
  authorization_model text not null default 'scoped_session' check (authorization_model = 'scoped_session'),
  capital_requested numeric,
  capital_authorized numeric,
  capital_deployed numeric,
  capital_returned numeric,
  ending_assets jsonb,
  realized_pnl numeric,
  unrealized_pnl numeric,
  purpose text not null default '',
  duration_seconds bigint,
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
  updated_at timestamptz not null default now()
);

create index if not exists execution_capital_requests_job_id_idx
  on public.execution_capital_requests(job_id);

create index if not exists execution_capital_requests_status_idx
  on public.execution_capital_requests(status);

create index if not exists execution_capital_requests_requester_wallet_idx
  on public.execution_capital_requests(requester_wallet);

alter table public.execution_capital_requests enable row level security;

-- Deliberately no public/anon/authenticated policies are created here.
-- Execution-capital records must be accessed through the server API after
-- authentication and job-ownership checks. Supabase service-role operations
-- remain available to trusted server-side jobs.

comment on table public.execution_capital_requests is
  'Altana-only execution-capital authorization state. Separate from ERC-8183 job budget and never a custody record.';

comment on column public.execution_capital_requests.user_execution_wallet is
  'The user-controlled Altana wallet address. Do not populate this with the agent session key.';

comment on column public.execution_capital_requests.agent_session_key is
  'The agent signer/session-key address authorized by the user. This is not the wallet holding user capital.';

comment on column public.execution_capital_requests.capital_deployed is
  'Nullable until independently verified evidence exists; never default to zero.';

comment on column public.execution_capital_requests.realized_pnl is
  'Nullable until hash-verified execution evidence exists; never default to zero.';
