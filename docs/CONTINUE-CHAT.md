# AgentMarket — Continue Chat Handoff

## Branch

`marketplace-testnet`

## Repository

`Isaacava/vitejs-vite-evqziawy`

## Current project focus

The hackathon implementation is **ERC-8183-first**. AgentMarket is a general agent marketplace; it does not become a PancakeSwap-specific marketplace. The execution-capital feature beside ERC-8183 is currently restricted to the Altana scoped-session model because this is the wallet model where the marketplace can independently verify user-controlled authorization.

## Proven / working systems

- ERC-8004 agent discovery/indexing on BSC Testnet.
- Supabase agent registry and endpoint/capability indexing.
- ERC-8183 quote → accept → create/register → set budget → approve → fund → provider submit → evidence capture → evaluation → settlement.
- Supabase/cron job synchronization and deliverable evidence capture.
- Provider wallet / agent matching.
- ERC-8183 lifecycle console reads authoritative chain state.
- Vercel Hobby deployment works after consolidating Testnet API handlers behind `api/testnet.ts` to stay under the 12-function limit.

## Important architecture rule

```text
ERC-8183 job budget
    ≠
execution capital
```

The ERC-8183 job budget is the payment for hiring the agent. Execution capital is separate capital the user authorizes an agent to operate with.

## Altana execution-capital model

For this feature:

```text
User
  └─ connected wallet / Altana authority
       └─ grants scoped session

Agent
  └─ ordinary session key/address
       └─ executes only inside session scope
```

The agent private key stays on the agent execution service. AgentMarket must never receive it.

The session scope must be explicit:

- contract-call allowlist;
- spend cap;
- expiry;
- session-key identity;
- user-owned execution wallet.

Authorization is not considered verified until AgentMarket independently reads Altana's onchain KeyStore/session registry.

## Current execution-capital implementation

### Database

`supabase/migrations/20260825021000_add_execution_capital_requests.sql`

`execution_capital_requests` is Altana-only:

- `wallet_provider = 'altana'`
- `authorization_model = 'scoped_session'`
- one row per `job_id` is already enforced by a `unique` constraint in the original migration.
- RLS is enabled intentionally with no direct client policies; server APIs enforce authentication and job ownership.

The data separates:

- `user_execution_wallet`
- `agent_session_key`
- `session_key_id`

Capital/P&L values remain nullable and render as `Not yet observed` until independently verifiable evidence exists.

### Public execution-capability handoff — completed

The Grid execution service exposes a public descriptor at:

`GET /execution-capabilities`

with:

- BSC Testnet / chain 97;
- Altana scoped-session model;
- session key address;
- session public key;
- allowed target contracts;
- required 4-byte function selectors;
- `private_key_exposed: false`.

AgentMarket discovers this descriptor from either provider metadata or the registered ERC-8183 endpoint base, validates it, and stores it under:

`execution_capital_requests.evidence.execution_capability`

Validation includes public-key → address identity, non-empty target allowlist, non-empty selector allowlist, chain 97, Altana/scoped-session identifiers, and explicit private-key absence.

### Altana grant + independent verification — completed

`src/AltanaSessionGrantGate.tsx` performs the real `grantSession()` call using the user's wallet signer.

After the grant, the server:

1. checks the authenticated wallet owns the request;
2. binds the supplied session key ID to `keccak256(session public key)`;
3. checks the granted expiry;
4. reads Altana KeyStore `isValidKey(wallet, sessionKeyId)` on BSC Testnet;
5. only then changes `requested → authorized`;
6. records the grant transaction hash and authorization evidence.

### Authorized session → private Grid executor — completed

The consolidated Testnet dispatcher exposes:

`POST /api/testnet?route=execution-capital-execute`

Implemented in:

`server/_testnet/grid-execute.ts`

The bridge requires an independently authorized request and then reconstructs the verified public session descriptor from stored evidence. It re-checks:

- BSC Testnet / chain 97;
- Altana scoped-session identity;
- session expiry;
- user execution wallet ownership;
- session key identity;
- target allowlist;
- function selector allowlist;
- maximum batch size.

It then sends the descriptor and encoded call batch to the private Grid `/execute` endpoint with `GRID_EXECUTION_SHARED_SECRET`.

The agent private key is never sent through this endpoint.

After execution, AgentMarket independently queries BSC Testnet for the transaction receipt and stores hash/receipt evidence under the execution-capital request. `capital_deployed` and P&L remain nullable until an independent accounting path exists.

Dedicated documentation:

`docs/AGENT-EXECUTION-CAPITAL-GRID-EXECUTOR-README.md`

## Grid execution adapter

The first-party Grid Agent remains a separate strategy/provider service for ERC-8183. Its isolated execution package is:

`agents/grid/execution/`

Important files:

- `src/altanaExecutor.ts` — reconstructs the session from the agent's private key, validates public key/address identity, runs Risk Guardian, then calls the Altana SDK `execute()` on BSC Testnet.
- `src/riskGuardian.ts` — validates target/selector/expiry/value/batch rules.
- `src/server.ts` — private execution endpoint with bearer protection plus read-only PancakeSwap preflight.
- `src/types.ts` — execution/session types.
- `src/pancakeSwap.ts` — deterministic ERC-20 approval and PancakeSwap `exactInputSingle` calldata builder.
- `src/preflight.ts` — read-only Testnet router/token bytecode and calldata preflight.

The execution service exposes public capability metadata through:

`GET /execution-capabilities`

and the same public metadata through `GET /health`.

Read-only PancakeSwap preflight is available through:

`POST /preflight/pancake`

It never calls `Altana execute()` and always reports `broadcast: false`.

It checks that the configured router and both token addresses have deployed bytecode on BSC Testnet and returns deterministic call data.

Environment examples:

```text
PORT=8788
GRID_EXECUTION_SHARED_SECRET=<private>
ALTANA_SESSION_PRIVATE_KEY=<agent session private key>
GRID_ALLOWED_TARGETS=<comma-separated BSC testnet contract addresses>
GRID_ALLOWED_SELECTORS=<comma-separated 4-byte selectors>
PANCAKE_TESTNET_ROUTER=<verified BSC testnet router>
PANCAKE_TESTNET_POOL_FEE=<pool fee>
```

The selector allowlist must remain explicit. Empty selectors reject execution.

## Current CI / deployment checkpoint

The current branch has completed the capability handoff, private executor bridge, PancakeSwap call builder, read-only preflight, dedicated executor typecheck, and documentation checkpoint.

Recent commits:

- `fcd10a2d1234b8f408925ea9cfebe1ea17acadad` — expose PancakeSwap Testnet preflight;
- `70b4cf262a7d4beb0ce8add5db0bc637f7cb7279` — dedicated Grid executor TypeScript CI check;
- `ec963912827a7da95950bfc7894e1fe01884f55d` — document PancakeSwap executor preflight.

The GitHub Actions run for the dedicated executor CI is currently running. A previous capability-handoff implementation build completed successfully. The newest branch head must be checked again for a final all-jobs result before claiming CI green.

## Next exact implementation step

The remaining step is now **environment-backed Testnet execution proof**, not authorization plumbing or call encoding:

```text
verified Grid executor configuration
    ↓
verified Testnet router + token addresses
    ↓
read-only PancakeSwap preflight
    ↓
controlled Testnet call through authorized Altana session
    ↓
BSC Testnet receipt
    ↓
existing ERC-8183 evidence archive
```

Do **not** hard-code PancakeSwap contract addresses in the generic marketplace. The Grid agent must declare its target/selector requirements through its execution capability descriptor.

Do **not** mark the Grid agent as a real trading executor until its executor service is actually reachable/configured and a real BSC Testnet PancakeSwap call has been demonstrated with a receipt.

## After the real execution proof

1. Verify the isolated Grid executor service is reachable with the expected shared secret.
2. Verify the Testnet router/token addresses and selector allowlist from the live executor configuration.
3. Run the read-only PancakeSwap preflight.
4. Execute one controlled Testnet call through the already authorized Altana session.
5. Capture and independently verify the receipt.
6. Attach the execution evidence to the existing ERC-8183 deliverable archive.
7. Record final assets/P&L only from independently verified state/evidence.
8. Add session revocation and expiry handling.
9. Add independent mid-session spend/asset tracking.

## Documentation rule

Every new feature gets its own README. Existing phase READMEs include:

- `docs/EXECUTION-PROFILES-README.md`
- `docs/PROTOCOL-AWARE-HIRING-README.md`
- `docs/ERC8183-HIRING-LIFECYCLE-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-ALTANA-INTEGRATION-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-GRID-EXECUTOR-README.md`
