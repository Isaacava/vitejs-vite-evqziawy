revoke execute on function public.sync_chain_job_state_fanout() from public;
revoke execute on function public.sync_chain_job_state_fanout() from anon, authenticated;
grant execute on function public.sync_chain_job_state_fanout() to postgres;
