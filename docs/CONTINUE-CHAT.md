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

The consolidated Testnet dispatcher now exposes:

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
- `src/server.ts` — private execution endpoint with bearer protection.
- `src/types.ts` — execution/session types.

The execution service exposes public capability metadata through:

`GET /execution-capabilities`

and the same public metadata through `GET /health`.

It explicitly does **not** expose the session private key.

Environment examples:

```text
PORT=8788
GRID_EXECUTION_SHARED_SECRET=<private>
ALTANA_SESSION_PRIVATE_KEY=<agent session private key>
GRID_ALLOWED_TARGETS=<comma-separated BSC testnet contract addresses>
GRID_ALLOWED_SELECTORS=<comma-separated 4-byte selectors>
```

The selector allowlist must remain explicit. Empty selectors reject execution.

## Current CI / deployment checkpoint

The branch currently ends at:

`ed4879094f0a2493f5342afd3351fe1990cb3a76`

The execution bridge itself was added in commits:

- `db96cc398bda49bd57012370f13156fede9d459d` — bridge endpoint;
- `c527c96233c5eab589a66ef0750721144ef9da95` — activity-recording fix;
- `33bd4d786cad73acd3f9f5567f6ce9ccca810bcf` — consolidated Testnet route;
- `ed4879094f0a2493f5342afd3351fe1990cb3a76` — dedicated bridge documentation.

The TypeScript/Vite CI build previously completed successfully on the capability-handoff implementation before this executor bridge was added. The current Vercel deployment for the latest branch head is queued and must be checked for READY/FAILED before treating the new bridge as deployed.

## Next exact implementation step

The next task is no longer the authorization plumbing. It is the **real Testnet call builder and execution proof**:

```text
Grid strategy
    ↓
PancakeSwap-specific call builder
    ↓
encoded target + selector + value
    ↓
Risk Guardian
    ↓
Altana session execute()
    ↓
BSC Testnet transaction receipt
    ↓
existing ERC-8183 evidence archive
```

Do **not** hard-code PancakeSwap contract addresses in the generic marketplace. The Grid agent must declare its target/selector requirements through its execution capability descriptor.

Do **not** mark the Grid agent as a real trading executor until its executor service is actually reachable/configured and a real BSC Testnet PancakeSwap call has been demonstrated with a receipt.

## After the real execution proof

1. Add the PancakeSwap/Testnet call builder for the Grid strategy.
2. Execute one controlled Testnet call through the authorized Altana session.
3. Capture and verify the receipt.
4. Attach the execution evidence to the existing ERC-8183 deliverable archive.
5. Record final assets/P&L only from independently verified state/evidence.
6. Add session revocation and expiry handling.
7. Add independent mid-session spend/asset tracking.

## Documentation rule

Every new feature gets its own README. Existing phase READMEs include:

- `docs/EXECUTION-PROFILES-README.md`
- `docs/PROTOCOL-AWARE-HIRING-README.md`
- `docs/ERC8183-HIRING-LIFECYCLE-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-ALTANA-INTEGRATION-README.md`
- `docs/AGENT-EXECUTION-CAPITAL-GRID-EXECUTOR-README.md`
