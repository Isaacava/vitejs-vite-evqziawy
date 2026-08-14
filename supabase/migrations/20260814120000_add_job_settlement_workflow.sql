create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  mission_task_id uuid references public.mission_tasks(id) on delete cascade,
  chain_job_id bigint,
  provider_agent_id uuid references public.marketplace_agents(id),
  client_wallet text,
  status text not null default 'open' check (status in ('open','funded','accepted','in_progress','submitted','terminal','disputed','cancelled')),
  description text not null default '',
  budget numeric not null default 0 check (budget >= 0),
  payment_token text,
  deliverable text,
  created_at timestamptz not null default now(),
  funded_at timestamptz,
  accepted_at timestamptz,
  submitted_at timestamptz,
  terminal_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  verdict text not null check (verdict in ('pending','approve','reject','disputed')) default 'pending',
  evaluator_address text,
  evidence jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  mission_id uuid references public.missions(id) on delete set null,
  token_address text,
  token_symbol text,
  amount numeric not null default 0 check (amount >= 0),
  status text not null default 'escrowed' check (status in ('escrowed','released','refunded','failed')),
  tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reputation (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.marketplace_agents(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  score numeric not null default 0,
  source text not null default 'platform' check (source in ('platform','erc8004','validation_registry')),
  feedback jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid references public.missions(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  tx_hash text not null,
  chain_id bigint not null default 56,
  kind text not null,
  status text not null default 'submitted' check (status in ('submitted','confirmed','failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid references public.missions(id) on delete cascade,
  task_id uuid references public.mission_tasks(id) on delete cascade,
  recipient text,
  kind text not null,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists jobs_task_status_idx on public.jobs(mission_task_id, status);
create index if not exists jobs_chain_job_id_idx on public.jobs(chain_job_id);
create index if not exists evaluations_job_id_idx on public.evaluations(job_id);
create index if not exists payments_job_id_idx on public.payments(job_id);
create index if not exists reputation_agent_id_idx on public.reputation(agent_id);
create index if not exists transactions_job_id_idx on public.transactions(job_id);
create index if not exists notifications_mission_id_idx on public.notifications(mission_id);

alter table public.jobs enable row level security;
alter table public.evaluations enable row level security;
alter table public.payments enable row level security;
alter table public.reputation enable row level security;
alter table public.transactions enable row level security;
alter table public.notifications enable row level security;

create policy "public can view jobs" on public.jobs for select to public using (true);
create policy "public can view evaluations" on public.evaluations for select to public using (true);
create policy "public can view payments" on public.payments for select to public using (true);
create policy "public can view reputation" on public.reputation for select to public using (true);
create policy "public can view transactions" on public.transactions for select to public using (true);
create policy "public can view notifications" on public.notifications for select to public using (true);
