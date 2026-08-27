-- Controlled BSC Testnet execution-capital proof limit.
-- The phase-2 proof must never authorize more than exactly 1 U.
-- Existing rows must already satisfy this constraint before the migration is applied.

alter table public.execution_capital_requests
  drop constraint if exists execution_capital_requests_testnet_one_u;

alter table public.execution_capital_requests
  add constraint execution_capital_requests_testnet_one_u
  check (capital_requested = 1);

comment on constraint execution_capital_requests_testnet_one_u on public.execution_capital_requests is
  'Controlled BSC Testnet execution-capital proof is limited to exactly 1 U.';
