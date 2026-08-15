create table if not exists public.session_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  wallet_address text not null,
  allowed_tokens jsonb not null default '[]'::jsonb,
  allowed_protocols jsonb not null default '[]'::jsonb,
  max_total_value numeric(38, 18) not null default 0,
  max_single_action_value numeric(38, 18) not null default 0,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_permissions_expiry_check check (expires_at > starts_at),
  constraint session_permissions_total_nonnegative check (max_total_value >= 0),
  constraint session_permissions_single_nonnegative check (max_single_action_value >= 0)
);

create index if not exists session_permissions_user_idx on public.session_permissions(user_id, status, expires_at);
create index if not exists session_permissions_wallet_idx on public.session_permissions(lower(wallet_address));

create or replace function public.touch_session_permissions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.revoked_at is not null then
    new.status = 'revoked';
  elsif new.expires_at <= now() then
    new.status = 'expired';
  else
    new.status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists session_permissions_touch_updated_at on public.session_permissions;
create trigger session_permissions_touch_updated_at
before update on public.session_permissions
for each row execute function public.touch_session_permissions_updated_at();

alter table public.session_permissions enable row level security;

drop policy if exists session_permissions_owner_select on public.session_permissions;
create policy session_permissions_owner_select
on public.session_permissions
for select
using (auth.uid() = user_id);

drop policy if exists session_permissions_owner_insert on public.session_permissions;
create policy session_permissions_owner_insert
on public.session_permissions
for insert
with check (auth.uid() = user_id);

drop policy if exists session_permissions_owner_update on public.session_permissions;
create policy session_permissions_owner_update
on public.session_permissions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

comment on table public.session_permissions is 'Scoped user execution permissions: token/protocol allowlists, value caps, expiry and revocation. Does not store private keys.';
