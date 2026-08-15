create or replace function public.sync_chain_job_state_fanout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mission_id_value uuid;
  user_id_value uuid;
  task_id_value uuid;
  provider_wallet text;
  phase_title text;
  phase_body text;
  new_job_status text;
  new_mission_status text;
begin
  if old.chain_status is not distinct from new.chain_status then
    return new;
  end if;

  select mt.mission_id, mt.id, m.user_id, a.owner
    into mission_id_value, task_id_value, user_id_value, provider_wallet
  from public.mission_tasks mt
  join public.missions m on m.id = mt.mission_id
  left join public.agents a on a.id = new.provider_agent_id
  where mt.id = new.mission_task_id;

  phase_title := initcap(replace(coalesce(new.chain_status, 'unknown'), '_', ' ')) || ' confirmed';
  phase_body := 'Verified BSC Testnet chain state for this mission.';

  if new.chain_status = 'funded' then
    new_job_status := 'funded';
    new_mission_status := 'funded';
  elsif new.chain_status in ('created','registered','budget_set') then
    new_job_status := new.status;
    new_mission_status := 'planning';
  else
    new_job_status := new.status;
    new_mission_status := null;
  end if;

  if new_job_status is distinct from new.status then
    update public.jobs
      set status = new_job_status,
          funded_at = case when new.chain_status = 'funded' then coalesce(funded_at, now()) else funded_at end,
          updated_at = now()
    where id = new.id;
  end if;

  if mission_id_value is not null and new_mission_status is not null then
    update public.missions
      set status = new_mission_status,
          updated_at = now()
    where id = mission_id_value;
  end if;

  if user_id_value is not null then
    insert into public.user_activity(user_id, mission_id, job_id, type, title, description, metadata)
    values(
      user_id_value,
      mission_id_value,
      new.id,
      'chain_state_synced',
      phase_title,
      phase_body,
      jsonb_build_object('chain_status', new.chain_status, 'chain_job_id', new.chain_job_id, 'tx_hash', new.chain_tx_hash)
    );

    if new.chain_status = 'funded' then
      insert into public.notifications(user_id, mission_id, task_id, recipient, kind, title, body)
      values(
        user_id_value,
        mission_id_value,
        task_id_value,
        coalesce(provider_wallet, ''),
        'job_funded',
        'New funded mission',
        'A mission has been funded and is ready for the assigned provider.'
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_chain_job_state_fanout on public.jobs;
create trigger trg_sync_chain_job_state_fanout
after update of chain_status on public.jobs
for each row
when (old.chain_status is distinct from new.chain_status)
execute function public.sync_chain_job_state_fanout();
