alter function public.touch_session_permissions_updated_at() set search_path = public;

alter table public.users enable row level security;
alter table public.user_activity enable row level security;
alter table public.user_sessions enable row level security;
alter table public.agent_endpoints enable row level security;
alter table public.agent_capabilities enable row level security;
alter table public.agent_registry_syncs enable row level security;

drop policy if exists users_owner_select on public.users;
create policy users_owner_select on public.users for select using (auth.uid() = id);

drop policy if exists user_activity_owner_select on public.user_activity;
create policy user_activity_owner_select on public.user_activity for select using (auth.uid() = user_id);

drop policy if exists user_sessions_owner_select on public.user_sessions;
create policy user_sessions_owner_select on public.user_sessions for select using (auth.uid() = user_id);

drop policy if exists agent_endpoints_public_select on public.agent_endpoints;
create policy agent_endpoints_public_select on public.agent_endpoints for select using (true);

drop policy if exists agent_capabilities_public_select on public.agent_capabilities;
create policy agent_capabilities_public_select on public.agent_capabilities for select using (true);

-- agent_registry_syncs intentionally has no public policies: only service_role/backend access is allowed.
