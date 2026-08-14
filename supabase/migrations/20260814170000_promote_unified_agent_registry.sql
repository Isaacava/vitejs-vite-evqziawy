-- Unified Agent Registry
-- Applied to Supabase production as part of the BNB Agent Studio marketplace foundation.

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS id uuid;
UPDATE public.agents SET id = gen_random_uuid() WHERE id IS NULL;

INSERT INTO public.agents (id, agent_id, owner, uri, name, description, image, chain, indexed_at, category)
SELECT ma.id, ma.agent_id, COALESCE(ma.owner, ''), COALESCE(ma.endpoint, ''), ma.name, ma.description,
       NULL, 'bsc', ma.created_at, COALESCE(NULLIF(ma.role, ''), 'other')
FROM public.marketplace_agents ma
LEFT JOIN public.agents a ON a.agent_id = ma.agent_id
WHERE a.agent_id IS NULL;

UPDATE public.agents a
SET id = ma.id
FROM public.marketplace_agents ma
WHERE a.agent_id = ma.agent_id AND a.id IS DISTINCT FROM ma.id;

ALTER TABLE public.agents ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_pkey;
ALTER TABLE public.agents ADD CONSTRAINT agents_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS agents_agent_id_unique_idx ON public.agents(agent_id);

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'indexed',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'indexed',
  ADD COLUMN IF NOT EXISTS last_indexed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_health_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_first_party boolean NOT NULL DEFAULT false;

UPDATE public.agents a
SET status = ma.status,
    is_first_party = ma.is_first_party
FROM public.marketplace_agents ma
WHERE a.agent_id = ma.agent_id;

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_source_check;
ALTER TABLE public.agents ADD CONSTRAINT agents_source_check
  CHECK (source IN ('indexed', 'self_registered', 'first_party'));

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_verification_status_check;
ALTER TABLE public.agents ADD CONSTRAINT agents_verification_status_check
  CHECK (verification_status IN ('indexed', 'pending', 'verified', 'revoked'));

ALTER TABLE public.mission_tasks DROP CONSTRAINT IF EXISTS mission_tasks_agent_id_fkey;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_provider_agent_id_fkey;

ALTER TABLE public.mission_tasks
  ADD CONSTRAINT mission_tasks_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_provider_agent_id_fkey
  FOREIGN KEY (provider_agent_id) REFERENCES public.agents(id);

CREATE TABLE IF NOT EXISTS public.agent_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  endpoint_url text NOT NULL,
  protocol text NOT NULL DEFAULT 'erc8183',
  version text,
  status text NOT NULL DEFAULT 'unknown',
  last_checked_at timestamptz,
  latency_ms integer,
  status_code integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, endpoint_url, protocol)
);

CREATE TABLE IF NOT EXISTS public.agent_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  capability text NOT NULL,
  source text NOT NULL DEFAULT 'registration',
  confidence numeric NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, capability, source)
);

CREATE TABLE IF NOT EXISTS public.agent_registry_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  from_block bigint,
  to_block bigint,
  agents_seen integer NOT NULL DEFAULT 0,
  agents_upserted integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  error_message text,
  status text NOT NULL DEFAULT 'running',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS chain_status text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS chain_last_synced_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS chain_tx_hash text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS chain_error text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS block_number bigint;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS agents_category_status_idx ON public.agents(category, status);
CREATE INDEX IF NOT EXISTS agents_verification_idx ON public.agents(verification_status);
CREATE INDEX IF NOT EXISTS agent_endpoints_agent_idx ON public.agent_endpoints(agent_id);
CREATE INDEX IF NOT EXISTS agent_endpoints_status_idx ON public.agent_endpoints(status);
CREATE INDEX IF NOT EXISTS agent_capabilities_agent_idx ON public.agent_capabilities(agent_id);
CREATE INDEX IF NOT EXISTS agent_capabilities_capability_idx ON public.agent_capabilities(capability);
CREATE INDEX IF NOT EXISTS agent_registry_syncs_network_started_idx ON public.agent_registry_syncs(network, started_at DESC);
CREATE INDEX IF NOT EXISTS jobs_chain_status_idx ON public.jobs(chain_status);
CREATE INDEX IF NOT EXISTS jobs_provider_agent_idx ON public.jobs(provider_agent_id);
CREATE INDEX IF NOT EXISTS notifications_task_id_idx ON public.notifications(task_id);
CREATE INDEX IF NOT EXISTS payments_mission_id_idx ON public.payments(mission_id);
CREATE INDEX IF NOT EXISTS reputation_job_id_idx ON public.reputation(job_id);
CREATE INDEX IF NOT EXISTS transactions_mission_id_idx ON public.transactions(mission_id);
