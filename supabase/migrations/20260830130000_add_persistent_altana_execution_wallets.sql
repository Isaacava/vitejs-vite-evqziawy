create table if not exists public.altana_execution_wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  wallet_address text not null,
  signer_address text,
  chain_id integer not null default 97 check (chain_id = 97),
  wallet_provider text not null default 'altana' check (wallet_provider = 'altana'),
  authorization_model text not null default 'passkey' check (authorization_model = 'passkey'),
  rp_id text,
  status text not null default 'active' check (status in ('active','recovery_required','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint altana_execution_wallets_wallet_address_check check (wallet_address ~ '^0x[a-fA-F0-9]{40}$'),
  constraint altana_execution_wallets_signer_address_check check (signer_address is null or signer_address ~ '^0x[a-fA-F0-9]{40}$')
);

create unique index if not exists altana_execution_wallets_wallet_address_idx
  on public.altana_execution_wallets (lower(wallet_address));

create or replace function public.touch_altana_execution_wallets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists altana_execution_wallets_touch_updated_at on public.altana_execution_wallets;
create trigger altana_execution_wallets_touch_updated_at
before update on public.altana_execution_wallets
for each row execute function public.touch_altana_execution_wallets_updated_at();

alter table public.altana_execution_wallets enable row level security;

drop policy if exists altana_execution_wallets_owner_select on public.altana_execution_wallets;
create policy altana_execution_wallets_owner_select
on public.altana_execution_wallets
for select
using (auth.uid() = user_id);

comment on table public.altana_execution_wallets is
  'One persistent user-owned Altana Passkey execution wallet per AgentMarket user. No private key or passkey secret is stored.';
