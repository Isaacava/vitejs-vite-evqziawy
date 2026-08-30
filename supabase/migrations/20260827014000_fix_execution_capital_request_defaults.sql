alter table public.execution_capital_requests
  alter column capital_token set default 'U',
  alter column requested_duration_seconds set default 86400;

comment on column public.execution_capital_requests.capital_token is
  'Controlled Testnet execution-capital symbol. The first proof is fixed to U and does not transfer or custody funds.';

comment on column public.execution_capital_requests.requested_duration_seconds is
  'Requested execution-capital session duration in seconds. Controlled Testnet proof defaults to 24 hours.';
