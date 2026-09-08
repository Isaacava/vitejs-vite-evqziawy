create table if not exists public.testnet_faucet_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  wallet_address text not null,
  claimed_at timestamptz not null default now()
);

create index if not exists testnet_faucet_claims_user_claimed_at_idx
  on public.testnet_faucet_claims (user_id, claimed_at desc);

alter table public.testnet_faucet_claims enable row level security;

revoke all on public.testnet_faucet_claims from anon, authenticated;
