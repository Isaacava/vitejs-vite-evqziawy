# AgentMarket UX Architecture v2

## Product entry

Public landing page is a marketing surface only. The primary CTA is **Connect wallet**. Clicking it immediately opens the existing WalletConnect integration using project ID `1dbe8fd5e4974ae7c80d074c4082b5a0`, starts the signed AgentMarket authentication flow, and redirects to `/dashboard` after verification.

There is no intermediate marketplace landing page.

## Authenticated workspace

The authenticated workspace is the product shell. It contains one persistent navigation system with responsive desktop sidebar and mobile off-canvas navigation.

Primary navigation:

- Overview
- Discover agents
- Missions
- Activity
- Payments & escrow

Management:

- Testnet
- Register agent
- Permissions

The shell must always expose the active environment. Testnet displays **BSC Testnet · Chain 97** and is isolated from Mainnet.

## Core mental model

The product is organized around three entities:

**Agents → Missions → Jobs**

Agents are the supply side. Missions are the user's intent and business object. Jobs are the on-chain execution/escrow object behind a mission.

## Discovery

`/app` is the authenticated discovery marketplace, not the website landing page. It is reached from **Discover agents** in the workspace or from a contextual **Create mission** action.

Discovery should support search, category filters, capability signals, verification state, endpoint health, reputation and clear hire actions.

## Mission workspace

A hired task should converge into one mission workspace rather than exposing technical screens as the user's primary navigation.

A mission workspace conceptually contains:

- Overview
- Execution
- Evidence
- Payments
- Timeline

ERC-8183 transaction steps remain implementation details of the mission execution state machine.

## Transaction state machine

The user sees one accountable lifecycle:

`Quote → Preflight → Sign → Create → Fund → Executing → Submitted → Evaluating → Settled`

Failure states are represented inside the same mission workspace:

`Disputed` and `Refundable/Refunded`.

## Wallet and auth

WalletConnect is the single connection mechanism. The testnet branch uses the existing WalletConnect project ID `1dbe8fd5e4974ae7c80d074c4082b5a0` and BSC Testnet chain 97. The authenticated session is established only after the wallet signs the AgentMarket nonce challenge.

The authentication signature is separate from transaction authorization.

## Visual system

The application shell uses a modern SaaS/Web3 visual language:

- neutral light workspace background
- high-contrast dark sidebar
- indigo primary action
- compact status badges
- elevated white cards with restrained borders/shadows
- clear typography hierarchy
- responsive 12-column style layout behavior
- mobile off-canvas sidebar

The visual system should remain compatible with Bootstrap 5.3.x conventions without requiring every component to use Bootstrap classes. Existing project dependencies are preferred where possible to avoid unnecessary bundle growth.

## Separation of concerns

Marketing, authenticated workspace, discovery, mission execution, provider workspace and evaluator/admin tooling are distinct surfaces.

Technical protocol screens should not appear as the user's main navigation.

## Environment isolation

Testnet and Mainnet have independent:

- chain IDs
- contracts
- payment tokens
- provider configuration
- transaction history
- balances
- job state

Testnet data is never promoted into Mainnet state.
