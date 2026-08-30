# AgentMarket — Continue Chat Handoff

## Branch
`marketplace-testnet`

## Current focus
AgentMarket is ERC-8183-first. Execution capital is separate from the ERC-8183 job payment. The controlled proof is fixed at **1 U**, **24h**, on **BSC Testnet chain 97**. Native tBNB is separate setup/KeyStore/relay funding.

## Proven
- ERC-8004 discovery/indexing.
- ERC-8183 hiring lifecycle through settlement and evidence capture.
- Chain-first lifecycle console.
- Execution-capital request creation and Altana-only gating.
- Grid public execution-capability discovery/validation.
- Altana Passkey wallet creation.
- Automatic native tBNB funding from the connected AgentMarket WalletConnect wallet.
- 1 U execution-capital scope.

## Wallet model
```text
AgentMarket WalletConnect
  -> marketplace authentication / ERC-8183

Altana Passkey smart wallet
  -> user-owned execution wallet
  -> scoped agent session
```
AgentMarket must never receive the user's private key.

## U token
`0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`

## Grid capability
`https://grid-agent-testnet-v4-production.up.railway.app/erc8183/execution-capabilities`

The descriptor must declare BSC Testnet, Altana scoped session, explicit target/selector allowlists, and `private_key_exposed = false`.

## Altana registration research
The public BNB Chain TypeScript SDK documentation states:

```text
grantSession({ register:false })
    -> creates the scoped session without KeyStore registration

registerSessionKey({ wallet, signer, session })
    -> registers that exact session in the KeyStore
    -> documented as idempotent
```

This explains the previous failures: `register:true` caused `KeyStore: key already registered`; `register:false` alone made the session invisible to the KeyStore verifier. The correct flow is `grantSession(register:false)` followed by `registerSessionKey(...)`, then independent `isValidKey` verification.

Source checked:
`https://github.com/bnb-chain/bnbagent-sdk/blob/main/typescript/README.md`

## Current implementation
File: `src/lib/altanaSession.ts`

Flow:
```text
validate session key
 -> fee/balance check
 -> automatic WalletConnect tBNB top-up if needed
 -> grantSession(register:false)
 -> registerSessionKey({ wallet, signer, session })
 -> server KeyStore verification
 -> requested -> authorized
```

Latest commit:
`9c4c9da4e28776ec8fdc83a50ce5f2208fe85a94`

Important: the latest commit was corrected after Vercel reported that `registerSessionKey` requires `{ wallet, signer, session }`, not the grant result directly.

## Server verification
The verifier uses `ALTANA_KEYSTORE_ADDRESS` and checks request ownership, capability evidence, session-key identity, expiry, and `KeyStore.isValidKey(wallet, sessionKeyId)` before changing the request to `authorized`.

## Latest test checkpoint
Job `#685`:
```text
ERC-8183: Funded
Execution capital: REQUESTED
Capital: 1 U
Duration: 24h
Altana wallet: created and automatically funded
```

Last live blocker before the current fix:
`Altana KeyStore does not currently report this session key as valid for the Altana execution wallet`

That was caused by the old `register:false`-only flow.

## Previous fixes
- `capital_token` NOT NULL request failure: fixed.
- Duration field mismatch: fixed.
- Capital locked to exactly 1 U: fixed.
- Funded -> Submitted race: protected by the Grid worker hold.
- Duplicate WalletConnect provider/session storage: unified.
- Passkey/WebAuthn wallet creation: working.
- Automatic Altana wallet funding: working.
- Duplicate KeyStore admin registration: avoided.
- Missing `ALTANA_KEYSTORE_ADDRESS`: server now reaches KeyStore reads.

## Free-plan Railway
Use only the existing service `grid-agent-testnet-v4`. Do not create another Railway service. The Node executor remains embedded in that service.

## Deployment rule
```text
commit
 -> Vercel build
 -> Vercel runtime check
 -> Railway check where applicable
 -> fresh BSC Testnet validation
```
Do not call a commit verified until deployment checks are green.

## Exact next step
The current registration fix must have a **READY** Vercel deployment first. Then open Job `#685` and click `Approve execution authority` once.

Expected:
```text
registerSessionKey succeeds
 -> KeyStore.isValidKey = true
 -> execution-capital = AUTHORIZED
```

Do not proceed to actual execution until independent KeyStore verification succeeds.

## After authorization
```text
AUTHORIZED
 -> verified scope reconstruction
 -> read-only PancakeSwap preflight
 -> Risk Guardian
 -> one controlled BSC Testnet execution
 -> independent receipt
 -> execution evidence
```
Keep explicit targets/selectors, the 1 U spend cap, 24h expiry, batch limits, and no private-key exposure.