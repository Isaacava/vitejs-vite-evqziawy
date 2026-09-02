# AgentMarket UI/UX Design Authority

AgentMarket is a BNB agent studio marketplace for people who may know nothing about blockchain, agents, wallets, or smart contracts. The product must make the user's goal and next action understandable without requiring crypto knowledge.

## Core product principle

Design from the user's outcome backwards. Blockchain, ERC-8183, RPC, signatures, chain IDs, transaction hashes, contract addresses, selectors, gas, quotes, and protocol names are implementation details. They are not the default user interface.

A normal user should be able to:
1. describe what they want done in plain English,
2. understand which agent is recommended and why,
3. understand what will happen before authorizing it,
4. see clear progress while work is running,
5. understand the result and what to do next,
6. inspect technical evidence only when they deliberately open it.

## Anti-AI-slop rules

Never generate a page that feels like a generic AI dashboard, SaaS template, or copied crypto landing page.

Avoid:
- gratuitous gradients, neon glows, glassmorphism, floating blobs, excessive shadows, and decorative 3D objects;
- giant hero headlines that consume space without helping the task;
- arbitrary icon grids, emoji used as interface decoration, or invented illustrations;
- repeated cards with identical visual weight;
- excessive rounded pills, status chips, and badges;
- dashboard-style metric spam where every number is treated as equally important;
- fake precision, fabricated statistics, fabricated agents, fabricated trust signals, or placeholder data that looks real;
- technical jargon in primary copy;
- raw blockchain errors, RPC responses, calldata, hashes, addresses, selectors, stack traces, or contract state as default UI;
- dark cyberpunk crypto aesthetics unless a specific page has a real functional reason to use them;
- animation that exists only to look impressive;
- copy that sounds generated, vague, inflated, or repeatedly uses words like seamless, powerful, next-generation, intelligent, revolutionary, or unlock.

## Visual language

Keep the established AgentMarket visual identity: warm paper background, ink typography, restrained brass accent, green for confirmed/healthy states, rust for attention or blocked states, asymmetrical corners, strong editorial hierarchy, dashed dividers, and intentional whitespace.

Use asymmetry with purpose. A distinctive treatment should communicate hierarchy, state, or interaction—not simply decoration.

Prefer a small number of strong surfaces over many nested cards. A page should have a clear focal point, a secondary area, and supporting detail.

Typography should feel editorial and precise. Use display type for page hierarchy, body type for readable explanations, and monospace only for literal technical values or compact metadata.

## UX hierarchy

Every screen must answer these questions in order:
- Where am I?
- What can I do here?
- What matters right now?
- What happens next?
- What happened already?

The primary CTA must be obvious and specific. Prefer labels such as `Find an agent`, `Review mission`, `Fund mission`, `Approve access`, `See result`, or `Create mission` over generic `Continue`, `Submit`, or `Proceed`.

Use progressive disclosure. Summary first; detail second; raw evidence only on demand. Follow established guidance for progressive disclosure and status communication. Keep advanced technical information available without making it the default reading path.

## Plain-language blockchain UX

Translate protocol state into human outcomes.

Examples:
- `OPEN` -> `Ready to start`
- `FUNDED` -> `Payment secured`
- `ACCEPTED` -> `Agent accepted`
- `IN_PROGRESS` -> `Agent is working`
- `SUBMITTED` -> `Work submitted for review`
- `COMPLETED` -> `Mission complete`
- `REJECTED` -> `Mission could not start`
- `EXPIRED` -> `Mission expired`
- `CANCELLED` -> `Mission cancelled`

Do not expose raw chain errors in the primary interface. Convert them into a short explanation plus a concrete next action. Example: `Your wallet is on the wrong network. Switch to BNB Testnet to continue.`

Do not display transaction hashes, calldata, RPC messages, chain IDs, contract addresses, or low-level selectors unless the user explicitly opens `Technical details` or `View evidence`.

When wallet approval is needed, explain what the user is approving in ordinary language before opening the wallet. Use clear signing concepts: what will happen, what can be spent/changed, any limit, and whether access expires.

## Agent marketplace UX

Agent discovery is about trust and suitability, not raw scores.

Every agent card should prioritize:
- what the agent can accomplish;
- why it matches this goal;
- whether it is currently ready to accept work;
- concise evidence of reliability;
- what access or authority it needs.

Do not show a mysterious composite score without explaining the reason. Replace opaque ranking with understandable signals and a visible explanation such as `Best match because it supports this goal and is ready to accept work.`

## Empty, loading, and error states

An empty state should explain what is missing and offer the next useful action.

Loading states should preserve layout and communicate what is being loaded. Avoid generic full-screen spinners when the surrounding UI can remain useful.

Errors must answer:
1. what happened,
2. why it matters,
3. what the user can do next.

Keep the primary message short and progressive-disclose technical context.

## Information architecture

Prefer a small, stable navigation model. Keep primary navigation focused on the user's ongoing work: Overview, Discover, Missions, Activity, Payments. Put setup and advanced controls under Manage.

Do not create a separate page just to expose implementation terminology.

## Accessibility and interaction quality

Use visible keyboard focus, sufficient contrast, touch-friendly hit areas, descriptive labels, and semantic headings. Never rely on color alone for state.

Motion should be subtle and purposeful. Respect `prefers-reduced-motion`.

## Responsive behavior

The mobile experience is not a shrunken desktop page. Preserve the user's goal, current step, primary action, and key status first. Secondary metadata can collapse or move behind disclosure controls.

## Final anti-slop review

Before considering a page finished, reject it if:
- the first viewport cannot tell the user what to do;
- three or more surfaces compete equally for attention;
- the page contains more decoration than task guidance;
- a technical term is present without a human explanation;
- a number is shown without telling the user why it matters;
- the design could be pasted into an unrelated SaaS, trading dashboard, or AI app with no loss of identity;
- placeholder or inferred data is presented as verified fact;
- the most important action is visually weaker than secondary actions.

The goal is not to make AgentMarket look futuristic. The goal is to make it feel considered, trustworthy, calm, distinctive, and obvious to use.