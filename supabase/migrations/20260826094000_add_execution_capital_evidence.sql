create table if not exists public.execution_capital_execution_evidence (
  id uuid primary key default gen_random_uuid(),
  execution_capital_request_id uuid not null references public.execution_capital_requests(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  chain_id bigint not null check (chain_id = 97),
  execution_id text not null,
  calls_id text,
  executor_status text,
  transaction_hash text,
  receipt jsonb,
  receipt_verified boolean not null default false,
  calls jsonb not null default '[]'::jsonb,
  source text not null default 'grid_private_execution_service',
  created_at timestamptz not null default now(),
  unique (execution_capital_request_id, execution_id)
);

create index if not exists execution_capital_execution_evidence_request_idx
  on public.execution_capital_execution_evidence(execution_capital_request_id);

create index if not exists execution_capital_execution_evidence_job_idx
  on public.execution_capital_execution_evidence(job_id);

create index if not exists execution_capital_execution_evidence_tx_idx
  on public.execution_capital_execution_evidence(transaction_hash);

alter table public.execution_capital_execution_evidence enable row level security;

comment on table public.execution_capital_execution_evidence is
  'Independent BSC Testnet execution evidence linked to an Altana execution-capital request. Does not replace ERC-8183 deliverable hashing.';

comment on column public.execution_capital_execution_evidence.receipt_verified is
  'True only when AgentMarket independently observed the transaction receipt from the BSC Testnet RPC.';
