create table if not exists public.erc8183_events (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null,
  contract_address text not null,
  event_name text not null,
  block_number bigint not null,
  block_hash text,
  transaction_hash text not null,
  log_index integer not null,
  chain_job_id bigint,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(chain_id, contract_address, transaction_hash, log_index)
);

create index if not exists erc8183_events_job_idx
  on public.erc8183_events(chain_id, contract_address, chain_job_id, block_number);

create index if not exists erc8183_events_block_idx
  on public.erc8183_events(chain_id, contract_address, block_number);

create table if not exists public.erc8183_indexer_cursors (
  id text primary key,
  chain_id bigint not null,
  contract_address text not null,
  last_scanned_block bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique(chain_id, contract_address)
);

alter table public.erc8183_events enable row level security;
alter table public.erc8183_indexer_cursors enable row level security;
