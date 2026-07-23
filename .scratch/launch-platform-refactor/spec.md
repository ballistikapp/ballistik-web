# Launch Platform Architecture Refactor

Status: complete for tickets 01–18 (including Launch Options extraction and planned-mint / fee locality finish) before production ship

Ship rule: tickets `01`–`16` form the Platform refactor core. Tickets `17`–`18` finish Launch Options / shared mint-identity locality (planned mint for every Launch, fee composition above Platform, envelope `money` authority) before production. Intermediate tickets were allowed to break Launch; only the finished effort (including `18`) must be production-safe.

## Problem Statement

Ballistik’s Launch funnel and backend are currently organized around pump.fun assumptions. The shared Launch implementation owns pump-specific validation, cost calculation, wallet roles, metadata publication, transaction construction, Jito bundle behavior, confirmation, cleanup, recovery, and lifecycle persistence in one large module. The funnel mirrors that shape in one large pump-specific form.

This makes current Launch behavior difficult to change safely and would force the upcoming direct-to-DEX SPL Platform into pump-shaped fields and stages. Launch attempts are also conflated with owned Tokens in the user experience, historical inputs have no explicit Platform/version identity, and low-level Jito and pump.fun concerns leak across multiple callers.

Ballistik needs a deeper Launch architecture before SPL work starts: one shared lifecycle with small Platform interfaces, strong locality for pump.fun behavior, durable authoritative plans, and clear seams that can evolve when the real SPL requirements are known.

## Solution

Refactor Launch into a shared lifecycle module plus a deep Platform module. The shared lifecycle will own Launch identity, persistence, logs, progress, cancellation, retry lineage, plan durability, fee collection, and terminal status. The pump.fun Platform module will own pump-specific planning, wallet roles, metadata publication, execution, outcome classification, and recovery behind an explicit `preview / plan / execute / recover` interface.

Every new Launch and Token will carry an explicit Platform and version. New Platform input will use a discriminated shape with shared metadata and Platform-specific configuration. An immutable, secret-free Platform plan will be persisted before any funding or on-chain submission, and execution must use that exact plan.

The refactor will preserve current pump.fun capabilities except the system dev-wallet path, consolidate launch buys on the custom raw pump.fun instruction implementation, deepen the shared Jito submission module, split the Launch funnel into a shared shell plus Platform configuration modules, and separate Launch history from My Tokens.

SPL launching is not implemented by this effort. The backend will accept only the pump.fun Platform until a real SPL module exists. The generic Platform seam is intentionally allowed to evolve when SPL discovery provides concrete evidence.

## User Stories

1. As a User, I want to select a Platform in the Launch funnel, so that I understand how my Token will be created and initially traded.
2. As a User, I want pump.fun to remain available as the working Platform, so that existing launch capability continues after the refactor.
3. As a User, I want to see SPL as coming soon, so that I understand the planned direct-to-DEX option without being able to submit an unsupported Launch.
4. As a User, I do not want to see an EVM placeholder, so that the funnel advertises only the Solana Platforms Ballistik has actually planned.
5. As a User, I want shared Token metadata fields and Launch Options to remain consistent across the funnel, so that Platform selection does not make basic setup confusing.
6. As a User, I want Platform-specific settings shown only for my selected Platform, so that pump.fun fields do not leak into future SPL configuration and Launch Options are not labeled as pump.fun-only.
7. As a User, I want the Launch review surface to show a normalized monetary summary, so that I can compare immediate spend, temporary funding, permanent spend, and expected returns.
8. As a User, I want cost line items to retain meaningful labels, so that I can understand fees, buys, tips, rent, buffers, and expected returns.
9. As a User, I want preview costs to remain responsive and non-binding, so that I can explore configuration before submission.
10. As a User, I want the start-time plan to be authoritative, so that funding and execution use one consistent calculation.
11. As a User, I want a valid Launch submission to create visible history before planning begins, so that preflight failures are not silently discarded.
12. As a User, I want planning failures to show a safe, specific reason, so that I know what to fix.
13. As a User, I want insufficient-funds failures to appear as failed Launch attempts, so that my submitted attempt remains auditable.
14. As a User, I want a failed planning/preflight attempt to be retryable, so that I can create a fresh attempt after correcting the problem.
15. As a User, I want every retry to receive a fresh authoritative plan, so that stale allocations or external state are not reused.
16. As a User, I want the original failed Launch to remain immutable history, so that retries do not rewrite what happened.
17. As a User, I want current Launch progress and activity to remain visible, so that the refactor does not reduce operational feedback.
18. As a User, I want cancellation to remain available at safe points, so that I can stop reversible work.
19. As a User, I want cancellation after an irreversible submission to be classified using actual on-chain evidence, so that a landed Token is not falsely reported as canceled.
20. As a User, I want a Launch to succeed according to its Platform’s real completion criteria, so that success is not reduced to “a mint account exists.”
21. As a User, I want partial on-chain outcomes classified safely, so that recoverable funds and usable Tokens are not lost behind an incorrect terminal status.
22. As a User, I want confirmed Tokens kept usable when later persistence or cleanup is degraded, so that control-plane failures do not erase on-chain success.
23. As a User, I want managed launch funds returned after success where the Platform policy permits, so that temporary funding is not left behind.
24. As a User, I want failed Launch recovery capped to the amount funded for that attempt, so that shared or imported Wallet balances are not swept.
25. As a User, I want manual recovery to work from persisted Launch state after the original process is gone, so that custody does not depend on an in-memory object.
26. As a User, I want generated and imported Wallet secrets excluded from the persisted Platform plan, so that Launch history does not expose custody material.
27. As a User, I want my main Wallet usable as the pump.fun creator Wallet, so that the current `use_main` path remains supported.
28. As a User, I want to generate a pump.fun creator Wallet, so that managed creator custody remains supported.
29. As a User, I want to import a pump.fun creator Wallet, so that I can retain an existing creator identity.
30. As a User, I no longer want the system dev-wallet option, so that new Launches do not depend on a shared platform creator key.
31. As a User, I want pump.fun dev buys to remain supported, so that initial creator participation remains available.
32. As a User, I want pump.fun bundled buys to remain supported, so that atomic initial distribution remains available.
33. As a User, I want non-bundled pump.fun execution to remain supported, so that free and simpler Launch configurations continue to work.
34. As a User, I want bundle buy variance to retain fixed total spend, so that variance does not silently increase my funding requirement.
35. As a User, I want the configured bundler-wallet limit and transaction-size protections preserved, so that invalid bundles are not submitted.
36. As a User, I want Jito tips and adaptive resend behavior preserved for bundled Launches, so that bundle delivery remains reliable.
37. As a User, I want Mayhem Launches to retain their Token-2022 and dynamic lookup-table behavior, so that the beta pump.fun path still works.
38. As a User, I want vanity mint reservation and consumption behavior preserved, so that a failed attempt does not silently swap or consume the wrong mint.
39. As a User, I want distribution Wallet behavior preserved, so that purchased tokens can still be spread after launch.
40. As a User, I want post-Launch SOL cleanup preserved, so that excess managed Wallet funding returns to my main Wallet.
41. As a User, I want current Launch presets to keep working for supported pump.fun settings, so that preset links remain useful.
42. As a User, I want clone behavior to work for new-version pump.fun Launches, so that I can reuse prior configuration.
43. As a User, I want Launch history separated from My Tokens, so that attempts and owned on-chain Tokens are not presented as the same concept.
44. As a User, I want Launch history to include attempts that never created a Token, so that planning and preflight failures remain visible.
45. As a User, I want My Tokens to contain only persisted Tokens, so that failed pre-mint attempts do not masquerade as assets.
46. As a User, I want active Launch progress to continue appearing in the app shell, so that the history split does not hide ongoing work.
47. As a User with a legacy Launch, I want to view its history, so that old operational context remains available.
48. As a User with a legacy Token, I want to view it, so that old ownership records remain accessible.
49. As a User with legacy custody, I want exits, SOL reclaim, and permitted key access to remain available, so that the read-only policy does not strand assets.
50. As a User with a legacy Token, I do not want to start new buys or automation against unsupported historical state, so that the refactor does not execute through ambiguous configuration.
51. As a User with a legacy Launch, I do not want retry or clone actions, so that old flat input is not guessed into the new Platform contract.
52. As a User, I want launch usage fees included in the authoritative plan, so that preflight covers the complete main-Wallet requirement.
53. As a User, I want usage fees collected only after Platform success, so that failed or canceled Launches are not charged.
54. As a referred User, I want successful Launch fee collection to preserve Referral Payout behavior, so that the architecture refactor does not bypass the shared payment seam.
55. As a User, I want an already successful on-chain Launch to remain successful if fee collection later fails, so that an irreversible Token is not misclassified.
56. As an Operator, I want Launch Platform, version, plan status, and outcome classification visible in operational inspection, so that I can understand which implementation handled an attempt.
57. As an Operator, I want Platform-specific details available without exposing private keys, so that incident response remains useful and safe.
58. As an Operator, I want Jito telemetry retain enough endpoint, bundle, resend, and confirmation information, so that delivery failures remain diagnosable.
59. As a platform maintainer, I want shared lifecycle changes localized outside pump.fun implementation details, so that job behavior can evolve without editing transaction builders.
60. As a platform maintainer, I want pump.fun validation, planning, wallet roles, metadata publication, execution, classification, and recovery concentrated in one deep module, so that pump changes have locality.
61. As a platform maintainer, I want the Platform interface to remain small, so that the shared lifecycle does not learn venue-specific steps.
62. As a platform maintainer, I want Platform plans versioned and validated on read, so that persisted opaque data is never trusted without schema validation.
63. As a platform maintainer, I want execution to use the exact persisted plan, so that planning and funding assumptions cannot drift mid-attempt.
64. As a platform maintainer, I want Platform planning to avoid funding and on-chain writes, so that plan persistence remains the gate before irreversible effects.
65. As a platform maintainer, I want failed local planning preparation compensated, so that abandoned key references and reservations do not accumulate.
66. As a platform maintainer, I want Platform progress emitted through a lifecycle context, so that Platform modules do not write Launch or LaunchLog rows directly.
67. As a platform maintainer, I want expected operational failures returned as typed outcomes, so that RPC and venue errors map consistently to user-safe states.
68. As a platform maintainer, I want contract violations and implementation defects to remain exceptional, so that bugs are not confused with ordinary Platform failures.
69. As a platform maintainer, I want Jito submission to hide tip placement, versioning, simulation, resend, and confirmation behavior, so that callers receive leverage from its implementation.
70. As a platform maintainer, I want Jito to return signatures and structured telemetry without writing Launch or Exit bookkeeping, so that transport and domain meaning remain separate.
71. As a platform maintainer, I want pump.fun Launch and Holding Exit to retain ownership of their AppTransaction meanings, so that Jito does not become a cross-domain ledger.
72. As a platform maintainer, I want all pump.fun Launch buys built through the custom raw-instruction adapter, so that SDK and custom account-layout behavior cannot diverge.
73. As a platform maintainer, I want shared media storage separated from Platform metadata publication, so that future SPL metadata can reuse stored assets without calling pump.fun.
74. As a platform maintainer, I want Platform-specific Wallet roles stored without a global enum of every future role, so that SPL concepts do not leak into pump.fun or lifecycle code.
75. As a platform maintainer, I want a nullable Platform version to identify legacy Launches and Tokens, so that old records can be gated without inspecting arbitrary JSON.
76. As a platform maintainer, I want the backend to reject SPL until a real implementation and schema exist, so that impossible Launch records cannot be created.
77. As a platform maintainer, I want the first SPL implementation to be allowed to sharpen the generic seam, so that this refactor does not freeze guesses as architecture.
78. As a platform maintainer, I want future SPL work to add a deep Platform module rather than fork the shared lifecycle, so that Launch history, progress, retries, and recovery remain coherent.
79. As a platform maintainer, I want the first SPL release to use one Ballistik-selected DEX, so that a speculative generic DEX framework is not required.
80. As a platform maintainer, I want blockchain transaction construction to remain in Solana modules, so that business orchestration does not absorb instruction-level code.
81. As a platform maintainer, I want Launch business modules grouped together within the existing layered architecture, so that locality improves without introducing a new repository-wide organization pattern.
82. As a platform maintainer, I want implementation documentation updated with the new lifecycle, Platform, plan, Jito, and legacy behavior, so that future work does not reconstruct the architecture from code.
83. As a platform maintainer, I want schema changes prepared without agents executing migrations, so that database rollout remains under human control.
84. As a platform maintainer, I want the refactor delivered in reviewable stages, so that structural and financial behavior changes are not hidden in one rewrite.

## Implementation Decisions

- **Domain model**: `Launch` is the shared lifecycle for a User’s token creation attempt. `Token` is the resulting owned Solana mint. `Platform` identifies the selected launch path. `Managed Launch Wallet` is the cross-Platform term for Wallets prepared or funded for an attempt.
- **Platform availability**: New backend records accept only pump.fun in this effort. SPL may remain a disabled coming-soon funnel option but is not a valid schema or persisted execution state until its module exists. EVM is removed.
- **Future SPL direction**: The first SPL release will create a Solana token and initial liquidity on one DEX selected by Ballistik. Users will not select a DEX in that first release. No DEX abstraction is introduced by this refactor.
- **Explicit identity and versions**: Launch and Token records gain explicit Platform identity and nullable Platform/version markers. Existing records retain null versions and are legacy. New records use the first explicit version. Persisted input and plan payloads also carry schema versions owned by their Platform.
- **Legacy policy**: Legacy Launches and Tokens are custody-safe read-only. History/detail reads, exits, reclaim, and permitted key access remain. Retry, clone, new buys, and automation are denied at a single eligibility seam with a user-safe explanation.
- **Launch input**: New input is a discriminated structure with shared Token metadata, shared Launch Options (`vanityMint`, `removeAttribution`), a Platform discriminator, and a Platform-specific configuration object. Launch Options are Platform-agnostic and owned by the shared lifecycle. The pump.fun configuration holds venue settings only (creator wallet, buys, tips, Mayhem, distribution) and excludes the system dev-wallet option. Schema version `1` is revised in place for this shape (clean cut; refactor not yet in production).
- **Launch Options ownership**: The shared lifecycle materializes mint identity for every Launch into `LaunchPlannedMint` (vanity pool reserve or fresh mint key at plan time), applies Launch Attribution at publish over the user-authored description, and prices vanity/attribution usage fees into normalized money via shared helpers above the Platform module. Platforms consume those outcomes; they do not own those flags in Platform `config` or compose options fees in Platform `preview`.
- **Plan envelope**: `Launch.plan` persists `{ shellVersion, optionsOutcomes, money, platformPlan }`. `optionsOutcomes` always carries `mintPublicKey` + `plannedMintId` (plus vanity/attribution flags and nullable `reservedVanityMintId`). Envelope `money` is the only authoritative monetary summary; `platformPlan.money` is Platform-internal. Secrets never enter the envelope.
- **Planning compensation**: Lifecycle abandons planned mints and releases vanity reservations on plan persist / insufficient-funds failure. Platform `compensatePlanResources` owns only Platform-local wallet key refs.
- **Shared Platform interface**: The external Platform module interface has four independent operations: preview, plan, execute, and recover.
- **Preview semantics**: Preview is side-effect-free, non-authoritative, and intended for funnel display. It returns a normalized monetary summary and line items.
- **Planning semantics**: Planning validates Platform configuration, snapshots pricing/entitlements needed for the attempt, resolves exact allocations and identities, and produces a versioned immutable plan. It may create only unfunded local key references and reservations. It may not publish venue metadata, fund Wallets, or submit on-chain.
- **Plan contents**: The persisted plan envelope contains Launch Options outcomes (always `mintPublicKey` / `plannedMintId`, vanity/attribution policy), lifecycle-composed `money`, plus a Platform plan with public identities, Platform-specific role identifiers, exact allocations, Platform-internal money, intended effects, recovery caps/policy, and opaque Platform payload. It never contains private keys or raw secret material. Execute resolves mint secrets only via `plannedMintId`.
- **Plan validation**: The shared lifecycle treats the Platform payload as opaque. The Platform implementation validates its versioned plan schema whenever persisted data re-enters execute or recover.
- **Execution invariant**: The shared lifecycle persists the exact plan before execution. Execute cannot silently replan or alter allocations. Resource materialization must complete before funding, and funding must complete before venue submission according to Platform policy.
- **Recovery invariant**: Recover reconstructs behavior from the persisted plan and persisted transaction evidence. It is not dependent on the original process or an in-memory capability object.
- **Lifecycle ownership**: The shared Launch lifecycle owns Launch/LaunchLog persistence, plan durability, progress, cancellation state, retry lineage, terminal status mapping, and fee collection.
- **Platform ownership**: The pump.fun Platform module owns pump-specific validation, cost/funding planning, Wallet roles, pump metadata publication, raw instruction orchestration, bundle/non-bundle execution, confirmation, distribution, outcome classification, cleanup, and recovery policy.
- **Execution contexts**: Preview/planning/execution/recovery receive narrow lifecycle contexts. Platform modules report progress and structured events and query cancellation through these contexts; they do not update Launch or LaunchLog directly.
- **Cancellation**: Cancellation is cooperative at Platform-defined safe points. Once an irreversible submission may have landed, the Platform must confirm/classify the outcome instead of returning a false cancellation.
- **Outcome model**: Platforms return typed success, canceled, failed, partial/indeterminate evidence, and recovery results. Expected operational failures are results. Interface violations and implementation defects throw and are mapped to internal-safe lifecycle failures.
- **Success ownership**: Each Platform defines its own success and partial-effect classification. The shared lifecycle persists that classification and must not infer success solely from mint existence.
- **Failed preflight records**: Any request that passes the external input schema creates a Launch before Platform planning. Planning, feature-gate, and insufficient-funds failures transition it to visible, retryable `FAILED` history. Requests rejected by the input schema create no record.
- **Retry**: Retry always creates a new Launch linked to the failed attempt, uses the saved new-version input, and creates a fresh Platform plan. The prior Launch and plan remain immutable.
- **No durable resume**: Mid-execution process restart/resume and durable queues are not part of this effort. Interrupted attempts use existing failure classification and recovery behavior; the architecture must not claim resumability.
- **Normalized money**: Platform preview/plan expose a shared summary for immediate required balance, temporary funding, expected return, permanent spend, expected main-Wallet deltas, usage fees, and labeled line items. Platform execution details remain opaque.
- **Pricing and billing**: A Platform planner uses shared pricing policy to produce Platform feature fee line items. The shared lifecycle includes the planned fee in preflight and collects it through the existing fee-collection seam only after Platform success. Referral splitting remains inherited. Post-success fee-collection failure logs a warning and does not reverse on-chain success.
- **Managed Launch Wallets**: The recovery-wallet model is generalized to Managed Launch Wallets. Shared fields retain public identity, Platform-defined role identifier, managed status, funded amount/cap, cleanup/reclaim state, signatures, errors, and timestamps. Platform role identifiers are not a global Prisma enum.
- **Media and metadata**: Shared media logic validates, normalizes, and stores uploaded assets. Shared metadata stores the user-authored description; Launch Attribution is applied at Platform publish from metadata + Launch Options. Each Platform validates its metadata constraints and publishes the Platform/venue metadata document. pump.fun banner behavior remains pump-specific.
- **Pump execution**: All new pump.fun launch buys use the custom raw-instruction implementation. PumpFunSDK is removed from Launch. Standard, Mayhem, bundled, and non-bundled behavior continue through one pump instruction path.
- **Removed system Wallet path**: The system dev-wallet option, launch branches, configuration dependency, and new-record behavior are removed. Legacy system Wallet custody remains accessible under the legacy policy where applicable.
- **Jito interface**: Jito becomes a deep transport module with a narrow submission interface. It hides tip placement/account selection, transaction versioning, lookup-table compilation, simulation, endpoint rotation, resend/rebuild, and confirmation. It returns signatures, bundle identity, confirmation evidence, and structured telemetry.
- **Jito bookkeeping**: Jito does not create AppTransaction rows or assign Launch/Exit meanings. Pump Launch and Holding Exit callers create and settle their own transaction records using Jito results.
- **Pump transaction packing**: Packing rules, buyer-to-transaction/signature mapping, Mayhem lookup-table use, serialized-size checks, and bundle limits concentrate in the pump.fun Platform implementation and Solana transaction builders. Duplicated constants must be removed.
- **Funnel structure**: The client funnel becomes a shared shell for Platform selection, shared metadata, Launch Options, navigation, submission, and normalized review. Launch Options is the shared section for vanity/attribution; the pump.fun funnel module injects Platform-specific toggles (e.g. Mayhem) into that section via a slot while Mayhem remains in pump `config`. Remaining pump fields (Dev Wallet, Bundler) stay in their own sections under `components/launch/platforms/pumpfun/`. Future SPL adds its own configuration module / slot content.
- **Read surfaces**: Launch history and My Tokens become separate user-facing surfaces and data contracts. Launch history includes all attempts, including those without Tokens. My Tokens contains persisted Tokens only.
- **Ops visibility**: Ops Launch reads include Platform/version, whether a plan exists, normalized plan summary where safe, and outcome classification. Opaque raw plan payload and secrets are not dumped by default.
- **Module organization**: Business modules are grouped under the existing Launch area within the services layer. Blockchain-specific transaction construction and external protocol adapters remain in Solana modules. This preserves repository layering while improving locality.
- **Platform registry**: A single typed registry resolves the pump.fun Platform module. Unsupported Platforms fail before record creation at input validation. The registry/interface may be revised when SPL provides a second real implementation.
- **Shared interface evolution**: Adding SPL is not required to leave every shared type untouched. It may sharpen normalized summaries, outcomes, or lifecycle contracts when concrete differences are known, but it must not reintroduce pump assumptions into the shared lifecycle.
- **Implementation documentation**: Launch, bundle/Jito, pricing, Ops, Wallet/recovery, and project overview documentation must be updated with the new terms, lifecycle, invariants, and removed system path.
- **Database rollout**: Agents modify the Prisma schema and regenerate the client when implementation reaches that stage. A human creates/runs/reviews migrations and any required data backfill.
- **Production ship gate**: No application code from this effort is pushed to production until tickets `01`–`18` are complete. Intermediate tickets may leave Launch broken, half-routed, or dependent on transitional delegates. Do not add compatibility scaffolding, dual-path keepalives, or “keep main green” work solely to preserve production readiness between tickets. Staging/review branches may break; only the finished effort must be production-safe.
- **Delivery stages**:
  1. Add Platform/version/input contracts, legacy gating, normalized money types, and persistence fields without changing execution.
  2. Introduce shared lifecycle and Platform registry, then route current pump behavior through compatibility delegates.
  3. Extract authoritative pump preview/planning and Managed Launch Wallet preparation.
  4. Extract pump execution/classification/recovery; consolidate raw buys and remove system/PumpFunSDK branches.
  5. Deepen Jito submission and update Pump Launch/Holding Exit bookkeeping callers.
  6. Split the funnel into shared and pump modules; separate Launch history from My Tokens and enforce legacy capabilities.
  7. Remove obsolete delegates/dead modules, update Ops projections and implementation documentation.
  8. Extract Launch Options from pump config; lifecycle-owned mint identity and plan envelope (ticket `17`).
  9. Finish planned-mint entity for every Launch, execute-via-`plannedMintId`, lifecycle options compensation, and fee composition above Platform (ticket `18`).

## Testing Decisions

- **What makes a good test**: Tests assert observable behavior through the highest stable module interface. They verify lifecycle state, plans, outcomes, transaction evidence, recovery caps, and external adapter calls without asserting internal helper functions, file organization, Prisma query shapes, or exact log prose.
- **Primary seam — shared Launch lifecycle**: Exercise start, plan persistence, execute ordering, typed outcome mapping, cancellation, retry, fee collection, legacy gating, and history behavior through the shared Launch lifecycle with a controllable Platform adapter.
- **Platform seam — pump.fun**: Exercise pump preview, plan, execute, and recover through the external Platform interface with controlled Solana/Jito/metadata/storage adapters. Internal planning and transaction helpers are not separate test surfaces unless they remain independently reused modules.
- **Infrastructure seam — Jito submission**: Exercise the narrowed Jito interface for simulation failure, accepted bundle, endpoint rotation, retryable status failures, dropped-bundle detection, resend/rebuild bounds, confirmation, and structured telemetry. Callers’ AppTransaction meanings are outside this seam.
- **Prior art**: Existing Launch database/recovery helper suites provide lifecycle and recovery conventions. Existing Jito bundle/client suites provide transport behavior and mock patterns. Existing usage-fee tests cover the post-success collection seam and Referral Payout inheritance.
- **Lifecycle behaviors to cover**:
  1. Schema-valid start creates a Launch before planning.
  2. Planning validation or insufficient funds produces visible retryable `FAILED`.
  3. Plan is durably persisted before execute is invoked.
  4. Execute receives exactly the persisted plan/version.
  5. Retry creates a new Launch and fresh plan without mutating the prior attempt.
  6. Cancellation before irreversible effects produces canceled outcome and compensation/recovery.
  7. Possible on-chain success prevents false cancellation/failure classification.
  8. Platform success triggers planned fee collection; Platform failure/cancellation does not.
  9. Fee-collection failure after success does not downgrade Launch success.
  10. Legacy Launch/Token operations enforce the custody-safe read-only matrix.
- **Pump Platform behaviors to cover**:
  1. Preview is side-effect-free and returns normalized money.
  2. Plan excludes secrets and fixes wallet identities, allocations, funding caps, and Platform version.
  3. Plan failure compensates local reservations/key references.
  4. System dev-wallet input is rejected; main/generated/imported remain supported.
  5. Bundled and non-bundled buys both use the raw pump instruction path.
  6. Fixed-total bundle variance, Wallet funding, and execution allocations remain identical.
  7. Standard and Mayhem plans choose the correct token program, fee recipients, and lookup-table strategy.
  8. Vanity reservation is consumed only after confirmed creation and released on eligible failures.
  9. Distribution and post-success cleanup preserve current behavior.
  10. Failure recovery never returns more than the plan-funded cap for a Managed Launch Wallet.
  11. Partial/indeterminate chain evidence maps to safe outcomes and recovery policy.
- **Jito behaviors to cover**:
  1. No bundle is sent after authoritative simulation failure.
  2. Tip placement and versioning remain hidden from callers.
  3. The accepting regional endpoint remains the preferred status endpoint.
  4. Cross-region status can confirm landing.
  5. Retryable Jito status infrastructure errors do not become on-chain failures.
  6. Dropped bundles rotate endpoint and respect resend/rebuild limits.
  7. Returned signatures and telemetry are sufficient for Pump Launch and Holding Exit bookkeeping.
- **Schema/contract behaviors to cover**:
  1. Only PUMPFUN is accepted in the new input version.
  2. Pump-specific configuration is required only inside the pump Platform branch.
  3. Persisted plan versions are validated before execute/recover.
  4. Null Platform version is treated as legacy.
  5. New-version records cannot enter legacy-only behavior and legacy records cannot enter new operations.
- **UI testing scope**: Prefer behavior at the form/schema and query/mutation seams. Verify Platform selection, pump configuration submission, normalized review data, disabled SPL state, removed EVM/system options, and separation of Launch history/My Tokens. Do not lock tests to markup or visual layout.
- **Replace, do not layer**: As behavior moves behind the deep lifecycle/Platform interfaces, retire tests that only exercise obsolete shallow helpers. Retain independent Solana builder tests only where the builders remain reused interfaces.

## Out of Scope

- Implementing SPL token mint creation.
- Selecting or integrating the first SPL DEX.
- User-selectable DEXes.
- A generic DEX adapter framework.
- EVM or any non-Solana chain.
- Multi-chain Wallet, Token, fee, or monetary abstractions.
- Downstream multi-Platform buy, sell, Holding Exit, volume bot, pricing, chart, or dashboard interfaces.
- Durable queues, workflow engines, or mid-attempt process resume.
- Replaying an interrupted execution from a persisted continuation checkpoint.
- Rewriting legacy flat Launch input into the new schema.
- Enabling retry, clone, new buys, or automation for legacy records.
- Removing custody-safe exit, reclaim, or key access from legacy records.
- Changing current pump.fun fee amounts, Referral Payout rules, or subscription entitlements.
- Changing pump.fun limits, minimum buy amounts, variance policy, Jito retry policy, vanity behavior, Mayhem behavior, distribution behavior, or recovery caps except where required to remove duplication without changing outcomes.
- A new generic transaction journal module; Launch and Exit keep their current domain bookkeeping ownership.
- Encrypting existing private keys at rest.
- Running or generating database migrations; migration execution remains human-owned.

## Further Notes

- **Agent note — breakage between tickets is expected.** Application code for this effort is not production-bound until ticket `16` lands. Prefer the direct cut for each ticket over preserving a working Launch path for later tickets or production.
- The generic Platform seam is intentionally provisional. It is deeper than the current implementation because it hides pump.fun behavior, but its shared types may be revised when SPL provides a second concrete adapter.
- The architectural deletion test is: deleting the pump.fun Platform module should force its validation, planning, metadata, Wallet-role, execution, classification, and recovery complexity back into the shared lifecycle. Deleting the shared lifecycle should force status, logs, cancellation, retry, plan durability, and fee orchestration into every Platform.
- The Platform plan is operational intent, not a durable workflow continuation. Its existence gates funding and supports recovery/audit, but does not imply resumable execution.
- Historical records remain identifiable through null versions rather than JSON-shape inference.
- Domain language is maintained in `CONTEXT.md`; implementation details remain in implementation docs and this spec.
- No existing ADR is contradicted. Referral fee collection continues through the established atomic split/live-rate behavior.
- After approval, split this spec into small staged implementation issues before editing the full refactor.
