alter table public.execution_capital_requests
  add column if not exists capital_token text,
  add column if not exists capital_symbol text,
  add column if not exists capital_decimals integer,
  add column if not exists allowed_calls jsonb not null default '[]'::jsonb,
  add column if not exists session_expiry bigint;

comment on column public.execution_capital_requests.capital_token is
  'ERC-20 token address used for the execution-capital spend permission; null means native token.';

comment on column public.execution_capital_requests.allowed_calls is
  'Explicit Altana contract-call allowlist copied from the verified grant request; empty is not a valid execution-capital authorization.';

comment on column public.execution_capital_requests.session_expiry is
  'Exact Unix expiry used for the Altana session grant, observed from the grant payload.';
