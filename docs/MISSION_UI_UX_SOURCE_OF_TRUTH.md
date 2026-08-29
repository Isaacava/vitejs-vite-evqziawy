# Mission UI/UX Source of Truth

## Approved reference

`agentmarket-full-demo-v2.html` is the visual source of truth for the AgentMarket Mission page and Mission Console.

The production implementation must preserve the reference's visual language, including:

- AgentMarket workspace typography: Space Grotesk, Manrope and DM Mono.
- Paper/ink/brass/green/rust palette.
- Asymmetric rounded cards and buttons.
- Mission list layout, filters, status badges and `Open console →` action.
- Mission Console header metadata: Mission, Agent, Chain job ID and Budget.
- Chain-verified state presentation and ERC-8183 lifecycle tracker.
- Execution Capital presentation using the Altana scoped-session model.
- Live execution, provider, deliverable/evidence and evaluator/settlement sections.

## Functional rule

UI changes must not require changing the protocol architecture. The page may display live data supplied by the current AgentMarket APIs/components, but it must not invent chain state, authorization, capital, P&L or execution evidence.

## Agent interoperability rule

The Mission and Mission Console UI are agent-agnostic. Grid is the first-party BNB Agent Studio/ERC-8183 test agent, but the visual contract does not assume Grid-specific implementation details.

## Execution-capital rule

The console distinguishes:

1. agent capability/declaration;
2. user-authorized Altana session scope; and
3. actual execution intent/evidence.

The UI must not turn capability claims into authorization, and must not display unknown amounts or P&L as zero.

## Current implementation

`src/WorkspaceMissionPage.tsx` and `src/WorkspaceMissionConsoleLive.tsx` are the live workspace implementations.

`src/ExecutionCapitalCard.tsx` supplies the demo-style execution-capital presentation while preserving the existing real request/authorization data flow.

The underlying ERC-8183, Altana, preflight, receipt verification, evaluation and settlement logic remains unchanged by the visual refactor.
