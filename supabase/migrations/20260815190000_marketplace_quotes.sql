create table if not exists public.marketplace_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique,
  agent_id uuid not null references public.agents(id) on delete cascade,
  requester_wallet text not null,
  goal text not null,
  request_metadata jsonb not null default '{}'::jsonb,
  price text not null default '',
  currency text not null default '',
  provider_quote jsonb not null default '{}'::jsonb,
  quote_hash text,
  chain_id integer not null default 97,
  environment text not null default 'testnet' check (environment = 'testnet'),
  status text not null default 'offered' check (status in ('requested','offered','accepted','rejected','expired','superseded')),
  provider_status_code integer,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketplace_quotes
  add column if not exists quote_hash text,
  add column if not exists chain_id integer not null default 97,
  add column if not exists environment text not null default 'testnet';

create index if not exists marketplace_quotes_agent_idx
  on public.marketplace_quotes(agent_id, created_at desc);

create index if not exists marketplace_quotes_requester_idx
  on public.marketplace_quotes(lower(requester_wallet), created_at desc);

create index if not exists marketplace_quotes_status_idx
  on public.marketplace_quotes(status, expires_at);

create unique index if not exists marketplace_quotes_hash_idx
  on public.marketplace_quotes(quote_hash)
  where quote_hash is not null;

alter table public.marketplace_quotes enable row level security;

create or replace function public.touch_marketplace_quotes_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketplace_quotes_updated_at on public.marketplace_quotes;
create trigger marketplace_quotes_updated_at
before update on public.marketplace_quotes
for each row execute function public.touch_marketplace_quotes_updated_at();
