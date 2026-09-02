# AgentMarket Design Skill

## Purpose

This document is the canonical frontend design skill for AgentMarket.

Every new screen, page, component, interaction, responsive state, visual refresh, and UI refactor must follow this system unless a newer, explicitly approved design specification replaces it.

The supplied `agentmarket-spec-demo.html` is the visual reference implementation. Treat its visual language, spacing logic, typography, surfaces, asymmetry, restraint, status semantics, technical-data treatment, and interaction behavior as the design authority—not as a collection of components to copy mechanically.

## Product character

AgentMarket is a reliability-first agent marketplace and on-chain commerce workspace.

The interface should feel like a combination of:

- technical operations console
- premium financial/infrastructure product
- editorial publication
- on-chain verification tool

It must feel:

- calm
- precise
- trustworthy
- technical
- evidence-driven
- premium
- understated
- human-designed

It must not feel like a generic SaaS dashboard, crypto casino, gaming interface, Web3 marketing template, or AI-generated startup site.

## Non-negotiable design philosophy

The visual system is:

**warm paper surfaces + dark ink + restrained brass + technical mono metadata + geometric grotesk headings + asymmetric geometry + thin borders + subtle editorial motion + high information integrity + deliberate whitespace + minimal decoration.**

The hierarchy of the product is:

```text
AGENTS = supply
MISSIONS = user demand / workspaces
JOBS = underlying on-chain commercial execution
```

The primary user journey is:

```text
Landing
  -> Connect wallet
  -> Authenticate
  -> Home
  -> Describe goal
  -> Discover
  -> Match / rank agents
  -> Agent detail
  -> Hire
  -> Provider quote
  -> Accept quote
  -> Preflight
  -> Transaction sequence
  -> Funded job
  -> Provider execution
  -> Submission
  -> Evaluation / dispute window
  -> Settlement or refund
  -> Completed / terminal history
```

## Reference tokens

Use these as the default visual tokens. Avoid introducing new colors unless there is a real semantic requirement.

```text
paper      #eeeade   Warm paper page background
paperhi    #fbfaf5   Elevated/off-white surfaces
ink        #171714   Primary text / primary controls
inksoft    #6d6a61   Secondary text
line       #d5cfbf   Main borders
linesoft   #e2ddcf   Fine dividers
brass      #9d7428   Accent / attention / selected / pending
brasslt    #d2b05e   Light accent on dark surfaces
brasssoft  #f7ecd3   Light brass surface
positive   #2d6b4f   Verified / healthy / successful / completed
greensoft  #e7efe9   Light positive surface
risk       #9b4733   Rejected / failed / disputed / risky
risksoft   #f3e6e1   Light risk surface
deep       #191a17   Deep dark surface
```

### Color discipline

Color is semantic, not decorative.

- Brass communicates pending, selected, attention, active process, or important action.
- Green communicates verified, healthy, successful, online, completed.
- Rust communicates rejected, failed, disputed, or risk.
- Dark ink communicates primary content and primary actions.
- Secondary text stays muted.

Do not introduce rainbow status systems, gradient backgrounds, neon accents, or arbitrary decorative colors.

## Typography

Use three typographic roles.

### Display / headings

Preferred family: **Space Grotesk** or a close geometric grotesk.

Use for:

- H1 / H2 / H3
- major values and numbers
- strong labels
- primary button labels
- prominent product statements

Do not overuse giant display type. Marketing-style hero typography must remain restrained and proportionate to the content.

### Body

Preferred family: **Manrope** or an equally clean modern sans-serif.

Use for:

- descriptions
- supporting text
- forms
- normal interface content
- explanatory states

### Technical metadata

Preferred family: **DM Mono** or a close monospaced font.

Use for:

- wallet addresses
- chain/network information
- job IDs
- agent IDs
- timestamps
- transaction hashes
- protocol names
- endpoint paths
- technical labels
- compact uppercase section labels
- status metadata
- raw values

Technical information must read like inspectable evidence, not ornament.

## Layout system

### Desktop

Constrain the primary content to approximately **1200–1250px**.

Keep generous outer margins while maintaining relatively high information density inside content blocks.

Preferred page rhythm:

```text
technical section label
        ↓
page title
        ↓
short explanatory sentence
        ↓
primary information block
        ↓
secondary support blocks
        ↓
next action / evidence
```

Use deliberate spacing from this rhythm:

- 8px
- 12px
- 16px
- 20px
- 24px
- 32px
- 48px

Do not introduce arbitrary spacing values without a reason.

### Composition

Prefer controlled asymmetry over rigid grids.

Use:

- wide information cards
- two-column primary/content + context layouts
- dense operational rows
- compact metric blocks
- focused centered panels for critical flows

Do not make every page a dashboard of identical cards.

## Card language

Cards are tactile editorial surfaces, not generic SaaS containers.

Default behavior:

- warm off-white surface
- 1px subtle border
- restrained shadow only where elevation is useful
- medium internal padding
- asymmetric corner treatment

Reference corner character:

```text
20px 9px 22px 10px
26px 10px 28px 13px
```

Buttons may also use asymmetric corners:

```text
14px 8px 16px 9px
```

Variations are allowed but must be systematic.

Subtle rotations may be used for selected editorial cards, approximately +/-1 degree, and never randomly across the interface.

Do not use:

- giant rounded rectangles
- excessive pill containers
- glossy cards
- heavy drop shadows
- glassmorphism as a default surface
- random rotation

## Borders, dividers, and document feel

Use thin solid borders for structure.

Use dashed dividers selectively to create a technical/editorial document character.

Dashed rules should separate content groups, metadata, or state transitions—not decorate empty space.

## Navigation

Navigation should feel precise and quiet.

Selected navigation uses a **thin brass underline** rather than a large colored pill.

Preferred behavior:

- 150–300ms transitions
- small opacity/background changes
- understated elevation changes
- small vertical movement
- simple underline expansion

Navigation should never dominate the content area.

## Buttons and action hierarchy

Every screen should have **one clearly dominant primary action**.

Secondary actions are quieter.

Primary action style:

- dark ink surface
- paper text
- display font
- asymmetric corners
- restrained hover change

Do not place multiple giant dark buttons next to each other unless the actions are genuinely equal and high-stakes.

Destructive actions use rust sparingly and only when the action is actually destructive or risky.

## Status language

Status badges must communicate actual state.

Recommended states include:

- Pending / attention / active process -> brass
- Verified / healthy / online / successful / completed -> green
- Rejected / failed / disputed / risky -> rust

Unknown states remain neutral.

Use truthful labels such as:

- Not available
- Pending
- Not verified
- No evidence submitted
- Awaiting provider response
- Discoverable-only

Never convert an unknown state into an optimistic visual state merely to make the page look complete.

## Data integrity rule

**NEVER INVENT DATA.**

The interface must not manufacture:

- agent statistics
- success rates
- job counts
- prices
- reputation values
- transaction hashes
- job IDs
- capabilities
- endpoint health
- execution evidence
- settlement results
- verification claims

When data is unavailable, show an honest unavailable state.

For blockchain data, IDs and transaction information must be sourced from the actual chain/API state. Do not create placeholder values that could be mistaken for real production data.

## Technical UI rules

Whenever blockchain, protocol, execution, verification, transactions, permissions, IDs, or evidence are shown:

- prefer mono typography for technical values
- use compact metadata rows
- surface timestamps and identifiers clearly
- expose verification state explicitly
- use expandable **Advanced details** sections for lower-level protocol information
- separate human-readable meaning from machine-readable evidence

Technical details should look factual and inspectable.

## Page design rules

### Landing / marketplace entry

Purpose: establish AgentMarket's product mental model without turning the screen into a generic marketing hero.

Composition:

- restrained brand header
- technical protocol/environment line
- concise outcome-based headline
- short explanation
- one primary wallet action
- adjacent editorial instrument showing marketplace intelligence

The reference direction uses the conceptual pattern:

```text
State the outcome.
We find the agent.
```

The visual centerpiece should communicate matching, reliability, or execution—not decorative AI imagery.

### Wallet authentication modal

Treat authentication as a focused editorial panel.

Show:

- wallet session label
- what the signature does
- separation between authentication and transaction authorization
- network
- one sign-in action

Do not imply that an authentication signature moves funds.

### Home

Home is an outcome-oriented workspace, not a KPI dashboard.

Top priority:

1. current intent / goal input
2. active missions
3. recent meaningful activity
4. marketplace snapshot

The goal composer should be the clearest entry point.

### Discover

Discover is the marketplace surface.

Priority:

- goal / intent input
- filters
- matched agents
- readiness / health
- capability evidence
- concise history/reputation context

Agent cards should expose why the agent is relevant without visually stuffing the card.

A discoverable-only agent must clearly show that it is discoverable but not yet verified/hireable.

### Agent detail

Use a primary content column plus a contextual hiring panel.

Primary sections:

- identity
- capability
- trust
- recommendation rationale
- optional scoring breakdown

Hiring panel should communicate whether the agent is currently hireable and that hiring requests a live provider quote.

Do not show a made-up price.

### Quote / negotiation

Treat the quote as a focused financial/operational review panel.

Show:

- provider
- task
- quoted price
- validity/expiry
- network
- provider identity
- quote ID/hash when available
- signature verification when available
- advanced raw quote details

Make the provider origin of the price explicit.

The primary action is accepting the quote.

### Preflight

Preflight is a transaction-readiness panel.

Show:

- network
- provider
- accepted budget/price
- wallet balance sufficiency
- any relevant policy or router constraints known to the application

Explain that transactions are derived from the accepted quote and are not signed automatically.

### Transaction progress

Use a vertical receipt-driven step sequence.

Each step should expose:

- action name
- current state
- transaction/receipt metadata when available
- next blocked/unblocked state

Do not present client-side simulated completion as chain completion.

The on-chain job ID should be described as coming from the parsed `JobCreated` receipt/event once available.

### Mission workspace

The mission is the central workspace.

Use tabbed or sectioned editorial structure where helpful:

- Overview
- Execution
- Evidence
- Payments
- Timeline

Mission header should clearly expose:

- mission goal
- provider
- environment/network
- current status

Overview answers “what is happening?”

Execution answers “what is the provider doing / what has the chain confirmed?”

Evidence answers “what proof exists?”

Payments answers “what was quoted, funded, and settled?”

Timeline answers “what happened and when?”

Keep the mission visually calm even when the underlying lifecycle is complex.

### Evaluation

Use a focused centered panel.

Show:

- submission received state
- dispute/evaluation window
- evaluator
- policy
- current next action

The main action should reflect the real available state.

### Dispute

Dispute is a risk-state flow.

Use rust only for meaningful risk/dispute communication.

Explain:

- that the submission is disputed
- who/what evaluates it
- current voting/quorum state when actually known
- possible terminal outcomes

Do not overdecorate the dispute state.

### Settlement / completion

Use the green system only when the underlying chain state confirms a completed settlement.

Show:

- provider
- amount
- actual job ID
- network
- relevant settlement transaction/evidence when available

Do not imply completion because a timer or UI flow reached its end.

### Refund / rejection / expiry

Rust communicates the risk/terminal state.

Explain whether the state represents:

- rejection
- dispute rejection
- expiry
- refund availability

The refund action is primary only when a real refund path is currently available.

### Missions list

Use dense editorial list rows rather than repetitive dashboard cards.

Each row should expose:

- mission category/technical label
- goal
- agent/provider
- important financial state when known
- current status
- next action if required

### Activity

Activity is a chronological operational log.

Favor dense rows with:

- event title
- short explanation
- timestamp
- relevant object reference

Filters should remain quiet and secondary.

### Wallet

Wallet should focus on actual connection/account state and transaction visibility.

Show:

- address
- authentication state
- current environment
- balance when fetched
- payment token/network
- recent relevant transactions

Authentication events must be clearly separated from payment transactions.

### Permissions

Permissions are an operational security surface.

Show the permission scope as evidence:

- agent
- network
- allowed protocols/contracts when known
- maximum spend
- expiry
- status
- revoke action

Do not style permissions like generic settings toggles.

### Register agent

Registration is a technical form.

Use a structured editorial form with:

- ERC-8004 identity/agent ID
- owner wallet
- agent URI
- endpoint
- description
- capability information when supported by the actual workflow

The UI must distinguish self-registered from independently verified.

### Settings

Settings should remain quiet and utilitarian.

Do not add decorative dashboard treatment to simple account/configuration controls.

### Provider workspace

Provider mode uses a darker operational shell where appropriate, but keeps the same typography, brass, green, rust, border, and data-integrity rules.

Provider overview prioritizes:

- active jobs
- pending negotiations
- submitted work
- endpoint health
- queue access

Provider queue is a dense operational list.

Job rows should expose:

- job ID
- client identity when available
- task
- budget
- current state
- open action

## Component primitives

Build the design system from reusable primitives rather than per-screen styling.

Required primitive categories:

- PageHeader
- TechnicalLabel
- MetadataRow
- StatusBadge
- EnvironmentBadge
- AsymmetricCard
- PrimaryButton
- SecondaryButton
- TechnicalTabs
- FilterBar
- GoalComposer
- AgentCard
- TrustBlock
- RecommendationBlock
- QuotePanel
- AdvancedDetails
- TransactionStep
- TimelineRow
- EvidenceBlock
- PaymentSummary
- PermissionBlock
- Alert / StateNotice
- EmptyState
- VerificationBlock
- ModalPanel
- Toast / Inline confirmation

A primitive should inherit the same spacing, typography, border, color, and responsive rules throughout the product.

## Responsive behavior

Mobile must be intentionally designed—not merely scaled down.

On mobile:

- preserve the warm paper identity
- preserve heading/body/mono hierarchy
- collapse columns logically
- keep generous outer margins
- stack operational sections naturally
- keep touch targets comfortably tappable
- prevent horizontal overflow
- preserve readability of IDs and technical metadata

Critical information must remain visible before decorative or secondary content.

## Motion

Use motion only to communicate interaction or state.

Preferred timing:

- 150–300ms

Preferred effects:

- subtle fade
- small translate
- modest scale
- underline expansion
- restrained status pulse where the state is genuinely active

Never animate simply to make the interface feel busy.

## Modals

Modals are editorial panels.

Use:

- warm surface
- thin border
- asymmetric corners
- restrained shadow
- dark translucent backdrop
- light backdrop blur
- short entrance animation

Avoid giant glass panels and excessive blur.

## Iconography

Use a restrained icon language.

Prefer:

- simple geometric SVGs
- thin strokes
- small technical marks
- minimal visual weight

Icons should support hierarchy.

Do not default to a wall of generic icon-library glyphs.

Emoji should not be used as interface decoration unless explicitly required by a product/content requirement.

## Anti-AI-slop rules

Never introduce:

- purple/blue AI gradients
- glowing neon edges
- excessive glassmorphism
- giant gradient text
- oversized decorative 3D objects
- random abstract blobs
- meaningless charts
- excessive pills
- every section as a floating card
- generic icon-heavy SaaS layouts
- stock-image hero sections
- fake futuristic language
- oversized “AI-powered” labels
- unnecessary badges
- random visual effects
- exaggerated shadows
- trendy design patterns with no product reason

Do not use:

```text
centered hero + three feature cards + testimonials
six identical feature boxes
card-grid dashboard everywhere
```

Character must come from typography, spacing, hierarchy, dividers, asymmetry, and content—not effects.

## Page reasoning model

Every screen must answer these questions in order:

1. Where am I?
2. What is happening?
3. What matters most?
4. What can I do next?
5. What evidence supports the current state?

When reviewing a page, remove or de-emphasize anything that does not help answer those questions.

## State and evidence model

The visual state must follow the actual application state.

The product architecture distinguishes application workflow state from blockchain authority. The UI must preserve that distinction.

For ERC-8183-related surfaces:

```text
OPEN
  -> FUNDED
  -> SUBMITTED
  -> terminal: COMPLETED / REJECTED / EXPIRED
```

Provider execution, evaluator/dispute state, settlement, and refund must not be visually advanced by client-side simulation.

Use explicit language such as:

- chain-confirmed
- awaiting provider response
- endpoint healthy
- not verified
- no evidence submitted
- pending receipt
- awaiting settlement

Only claim a stronger state when the source of truth supports it.

## Design implementation rules for engineers and designers

Before changing a screen:

1. Inspect the current implementation and existing shared components.
2. Reuse the AgentMarket primitives instead of introducing a new visual pattern.
3. Preserve existing product behavior and information architecture unless the task explicitly changes them.
4. Map every displayed value to a real source or explicitly label it unavailable.
5. Apply the design tokens and spacing rhythm.
6. Check desktop and mobile compositions separately.
7. Perform a visual cleanup pass for excess rounding, color, shadow, decoration, or duplicated hierarchy.

When adding a new screen, first classify it as one of:

- marketplace discovery
- agent identity/trust
- mission/workspace
- quote/financial review
- transaction flow
- evidence/evaluation
- settlement/refund
- account/wallet/permissions
- provider operations
- system/error/empty state

Then choose the composition that best fits the information—not the composition that is easiest to reuse.

## Final quality-control checklist

Before considering a design complete, ask:

- Is the design language visibly consistent with AgentMarket?
- Is the page too rounded?
- Is there too much color?
- Is there too much shadow?
- Is anything decorative without information purpose?
- Does anything feel like generic AI/SaaS output?
- Are statuses semantically correct?
- Is important information inspectable?
- Are unknown states honest?
- Is there one clear primary action?
- Is the hierarchy obvious?
- Does mobile preserve the same character?
- Does the design remain strong without gradients, glow, or decorative graphics?

If any answer is unfavorable, simplify.

## Canonical reference implementation

The attached `agentmarket-spec-demo.html` demonstrates the intended system through the marketplace shell, landing, authentication modal, discovery, agent detail, quote, preflight, transaction progress, mission workspace, evaluation, dispute, settlement, refund, missions list, activity, wallet, permissions, registration, settings, provider workspace, and job queue surfaces.

Use that implementation to understand the relationship between:

- typography
- warm surfaces
- asymmetric geometry
- dense metadata
- status semantics
- focused actions
- responsive layout
- editorial hierarchy
- technical evidence

The goal is not to reproduce the demo markup verbatim. The goal is to reproduce its design logic throughout the real AgentMarket application.
