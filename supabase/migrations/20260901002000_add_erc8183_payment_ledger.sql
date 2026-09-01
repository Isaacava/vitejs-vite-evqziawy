create table if not exists public.erc8183_payment_ledger (
  id uuid primary key default gen_random_uuid(),
  chain_id bigint not null,
  chain_job_id bigint not null,
  job_id uuid references public.jobs(id) on delete set null,
  mission_id uuid references public.missions(id) on delete set null,
  event_name text not null,
  token_address text,
  recipient text,
  amount_raw numeric,
  cumulative_amount_raw numeric,
  transaction_hash text not null,
  block_number bigint not null,
  log_index integer not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(chain_id, transaction_hash, log_index)
);

create index if not exists erc8183_payment_ledger_job_idx
  on public.erc8183_payment_ledger(chain_id, chain_job_id, block_number);
create index if not exists erc8183_payment_ledger_mission_idx
  on public.erc8183_payment_ledger(mission_id, created_at);

alter table public.erc8183_payment_ledger enable row level security;

create or replace function public.sync_erc8183_payment_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.jobs%rowtype;
  amount_value numeric;
  cumulative_value numeric;
  recipient_value text;
begin
  if new.event_name not in (
    'JobFunded','PaymentReleased','Refunded','PlatformFeePaid','EvaluatorFeePaid',
    'Settled','ClaimSubmitted','ClaimSettled','ClaimApproved'
  ) then
    return new;
  end if;

  select * into job_row from public.jobs where chain_job_id = new.chain_job_id limit 1;
  amount_value := nullif(new.payload->>'amount', '')::numeric;
  if amount_value is null then amount_value := nullif(new.payload->>'delta', '')::numeric; end if;
  cumulative_value := nullif(new.payload->>'cumulativeAmount', '')::numeric;
  recipient_value := coalesce(new.payload->>'recipient', new.payload->>'client', new.payload->>'evaluator', new.payload->>'settler');

  insert into public.erc8183_payment_ledger(
    chain_id, chain_job_id, job_id, mission_id, event_name, token_address,
    recipient, amount_raw, cumulative_amount_raw, transaction_hash,
    block_number, log_index, payload
  ) values (
    new.chain_id, new.chain_job_id, job_row.id, job_row.mission_id, new.event_name,
    job_row.payment_token, recipient_value, amount_value, cumulative_value,
    new.transaction_hash, new.block_number, new.log_index, new.payload
  )
  on conflict (chain_id, transaction_hash, log_index) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_erc8183_payment_ledger on public.erc8183_events;
create trigger trg_erc8183_payment_ledger
after insert on public.erc8183_events
for each row execute function public.sync_erc8183_payment_ledger();
