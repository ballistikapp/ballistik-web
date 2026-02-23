Executive Summary
Overall production readiness score: 2.5 / 10

This codebase has strong architectural intent (tRPC + Zod + service layer), but it is not safe for production handling real funds in its current state due to multiple key-management and endpoint-exposure failures.

Top 5 critical issues (must fix before production)
Unauthenticated wallet-drain endpoint exists and is publicly allowed
app/api/wallets/refresh/route.ts:14-33,96-123
proxy.ts:4
Private keys are stored in plaintext in DB (Wallet, Token, VanityMint) and used directly
prisma/schema.prisma:38,68,311
Wallet private keys are returned by API and rendered in client UI
server/trpc/routers/wallet.router.ts:47-60
server/services/wallet.service.ts:111-133,276-345
app/(app)/account/page.tsx:55-61,122-126,307-356
app/(app)/[tokenPublicKey]/wallets/[walletPublicKey]/page.tsx:88,130-137,500-548
Token private keys are leaked broadly to client surfaces (including sidebar payloads)
server/services/token.service.ts:23-26,38-42,89,101-103
server/trpc/routers/token.router.ts:7-14,15-25
app/(app)/layout.tsx:21,32 + components/layout/sidebar/app-sidebar.tsx:1,60-71
JWT security is weak by default (hardcoded fallback secret + 365d token)
lib/auth/jwt.ts:3-5,20-22
lib/config/env.ts:4-10 (JWT secret not validated)
Top 5 important issues (should fix soon)
Webhook route is not in proxy allowlist; callback traffic will be blocked by auth middleware
proxy.ts:4,25-27 vs app/api/webhooks/shyft/route.ts:162
Webhook auth is optional + no replay protection/rate limiting
app/api/webhooks/shyft/route.ts:165-173,175,181-197
No API abuse controls + public test write endpoints
server/trpc/routers/\_app.ts:15
server/trpc/routers/test.router.ts:13-24
Launch slippage defaults are unsafe (100% tolerance)
lib/config/launch.config.ts:40
Race-prone check-then-create flows for financial jobs
server/services/launch.service.ts:1344-1356
server/services/volume-bot.service.ts:379-390,456-520
server/services/holding-exit.service.ts:961-974
Detailed Audit Findings

1. Public unauthenticated fund-drain endpoint
   Severity: CRITICAL
   Category: Security
   File(s): app/api/wallets/refresh/route.ts, proxy.ts
   Line(s): route.ts:14-33,96-123; proxy.ts:4
   Description: /api/wallets/refresh is explicitly public in middleware and performs privileged transfers using private keys for all wallets.
   Risk: Complete platform fund theft / mass unauthorized transfers.
   Recommendation: Remove this route entirely from production. If required for admin operations, gate with strict auth + signed admin requests + IP allowlist.

// proxy.ts
const publicRoutes = ["/auth", "/api/trpc"]; // remove /api/wallets/refresh 2) Plaintext private key storage in database
Severity: CRITICAL
Category: Security
File(s): prisma/schema.prisma, server/services/auth.service.ts
Line(s): schema.prisma:38,68,311; auth.service.ts:54-58,122-124
Description: Private keys are persisted as plaintext strings and compared directly.
Risk: Any DB compromise = full custody compromise (irrecoverable financial loss).
Recommendation: Move to envelope encryption + KMS/HSM-backed key wrapping; decrypt only in signer service memory. Never compare raw keys in app logic. 3) Wallet private keys are returned to frontend
Severity: CRITICAL
Category: Security
File(s): server/trpc/routers/wallet.router.ts, server/services/wallet.service.ts, account/wallet pages
Line(s): wallet.router.ts:47-60; wallet.service.ts:111-133,276-345; UI lines above
Description: tRPC mutations return private keys, and client pages display/copy them.
Risk: XSS/browser compromise/session hijack => instant key exfiltration.
Recommendation: Remove key egress APIs. Replace with server-side signing endpoints only. 4) Token private keys leaked through API and server→client props
Severity: CRITICAL
Category: Security
File(s): server/services/token.service.ts, server/trpc/routers/token.router.ts, app/(app)/layout.tsx, components/layout/sidebar/app-sidebar.tsx
Line(s): token.service.ts:23-26,38-42,89,101-103; token.router.ts:7-25; layout.tsx:21,32; app-sidebar.tsx:1,60-71
Description: Token queries return full Prisma model (includes privateKey) and are consumed by client components and tRPC client pages.
Risk: Silent widespread key leakage to browser memory/network payloads.
Recommendation: Enforce DTO/select whitelists everywhere.

// token.service.ts
return prisma.token.findMany({
where: { userId },
select: { publicKey: true, name: true, symbol: true, imageUrl: true, createdAt: true }
}); 5) Insecure JWT defaults
Severity: CRITICAL
Category: Security
File(s): lib/auth/jwt.ts, lib/config/env.ts, server/trpc/routers/auth.router.ts
Line(s): jwt.ts:3-5; env.ts:4-10; auth.router.ts:40,63,106
Description: Hardcoded fallback JWT secret and 365-day session lifetime; secret not required by env schema.
Risk: Token forgery/session persistence after compromise.
Recommendation: Require strong JWT secret at boot, shorten TTL, rotate/refresh tokens. 6) Webhook route likely blocked by proxy auth middleware
Severity: HIGH
Category: Operations / Robustness
File(s): proxy.ts, app/api/webhooks/shyft/route.ts
Line(s): proxy.ts:4,25-27; webhook route path at route.ts:162
Description: /api/webhooks/shyft is not public in proxy allowlist; matcher includes API paths.
Risk: Shyft callbacks fail → stale balances/transactions, broken automation.
Recommendation: Explicitly allow webhook path in proxy or exclude API webhook paths from matcher. 7) Webhook validation is optional; no replay protections
Severity: HIGH
Category: Security
File(s): app/api/webhooks/shyft/route.ts
Line(s): 165-173,175,181-197
Description: Auth only enforced if secret is configured; no timestamp/nonce validation; no request throttling.
Risk: Spoofing/replay/DoS against ingestion pipeline.
Recommendation: Make secret required in production + HMAC/timestamp replay window + endpoint rate limits. 8) No API-level rate limiting; public test mutation exposed
Severity: HIGH
Category: Security / Abuse Prevention
File(s): \_app.ts, test.router.ts, app/api/trpc/[trpc]/route.ts
Line(s): \_app.ts:15; test.router.ts:13-24; route.ts:9-26
Description: Public test.create and no tRPC-level throttling middleware.
Risk: DB spam, cost amplification, service degradation.
Recommendation: Remove test router from production app router and add per-user/IP rate limiting middleware. 9) Launch slippage default is dangerously high
Severity: HIGH
Category: Solana
File(s): lib/config/launch.config.ts
Line(s): 40
Description: slippageBasisPoints defaults to 10000 (100%).
Risk: Catastrophic fills/front-running losses during volatile launches.
Recommendation: Cap default at conservative range (e.g., 100–500 bps) with hard upper bounds. 10) Race conditions in launch/exit/volume-bot creation
Severity: HIGH
Category: Robustness
File(s): launch.service.ts, volume-bot.service.ts, holding-exit.service.ts
Line(s): launch:1344-1356; volume:379-390,456-520; exit:961-974
Description: Check-then-create flows without DB locking/unique guard.
Risk: Duplicate concurrent jobs, double funding, inconsistent state.
Recommendation: Add transactional locking/idempotency keys and unique DB constraints where possible. 11) Holdings model lacks uniqueness guard
Severity: HIGH
Category: Database / Robustness
File(s): prisma/schema.prisma, server/services/holding.service.ts
Line(s): schema:323-341; refresh writes at holding.service.ts:391-533
Description: No @@unique([walletPublicKey, tokenPublicKey]) on Holding.
Risk: Duplicate holdings rows under concurrent refreshes, bad balances/PnL.
Recommendation: Add unique constraint + migrate duplicates safely before enforcing. 12) Env loading behavior unsafe for production
Severity: HIGH
Category: Operations / Security
File(s): lib/config/env.ts, lib/prisma.ts
Line(s): env.ts:32-34,13; prisma.ts:14-18
Description: Production env loader also loads development env files; DATABASE_URL optional and app continues.
Risk: wrong-secret/wrong-DB boot, environment drift, hidden misconfigurations.
Recommendation: strict prod env mode; fail fast if required vars missing. 13) Destructive migrations present without rollout safeguards
Severity: HIGH
Category: Operations / Database
File(s): migration SQLs
Line(s): e.g. 20260127180000...:4-10,29-42; 20260117130325...:30; 20260119114031...:8
Description: Multiple drop-column/drop-table/enum-removal migrations.
Risk: irreversible data loss during prod rollouts if sequencing/backups are weak.
Recommendation: add migration runbooks, backup/restore checks, and expand/contract strategy docs. 14) No security headers/CSP policy
Severity: HIGH
Category: Security / Operations
File(s): next.config.ts
Line(s): 3-8
Description: No CSP/HSTS/X-Frame-Options/etc configured.
Risk: Increased XSS/clickjacking exposure, especially dangerous with key material in browser.
Recommendation: configure strict headers and CSP nonce strategy. 15) Missing indexes on hot query fields
Severity: MEDIUM
Category: Performance / Scalability
File(s): prisma/schema.prisma, service query callsites
Line(s): Wallet model 36-56; Holding 323-341; Token 66-91; ShyftCallback 424-431
Description: Frequent filters on unindexed columns (e.g., Wallet.tokenPublicKey, Holding.tokenPublicKey/walletPublicKey, ShyftCallback.address).
Risk: table scans and latency spikes as data grows.
Recommendation: add targeted composite indexes based on query profiles. 16) Unbounded in-memory structures in long-running bot paths
Severity: MEDIUM
Category: Performance / Memory
File(s): server/solana/volume-bot-grpc.ts, server/services/volume-bot-worker.ts
Line(s): volume-bot-grpc.ts:26,64; volume-bot-worker.ts:67,573-583
Description: confirmedTxs and slippageFailures can grow without eviction over uptime.
Risk: memory bloat, degraded long-run stability.
Recommendation: add TTL/LRU eviction and periodic compaction. 17) Logging is inconsistent; production logs tracked in repo
Severity: MEDIUM
Category: Operations
File(s): multiple services, .gitignore, logs/_
Line(s): examples: volume-bot-worker.ts:181+, volume-bot.service.ts:464+, .gitignore:23-44
Description: heavy console._ usage bypasses structured logger; logs/ files are tracked.
Risk: noisy/unstructured observability, accidental sensitive telemetry persistence.
Recommendation: standardize on lib/logger.ts; remove tracked logs and ignore logs/. 18) Webhook cache invalidation path is serial and costly
Severity: MEDIUM
Category: Performance
File(s): app/api/webhooks/shyft/route.ts
Line(s): 102-135
Description: nested for loops with awaited touch calls run serially.
Risk: callback latency and backlog under bursts.
Recommendation: batch with bounded concurrency (mapWithConcurrency) and dedupe scopes before DB writes. 19) No dedicated health endpoint
Severity: MEDIUM
Category: Operations
File(s): app/api/_
Line(s): N/A (only trpc, wallets/refresh, webhooks/shyft routes exist)
Description: No explicit readiness/liveness endpoint with DB/RPC/gRPC checks.
Risk: poor deployment safety and delayed incident detection.
Recommendation: add /api/health and /api/ready with dependency probes and SLO metrics. 20) Dead/unused production code footprint
Severity: LOW
Category: Code Quality
File(s): components/template/_, server/solana/token-transactions-grpc.ts
Line(s): template files unused externally; token-transactions-grpc has no callsites
Description: orphaned components/modules increase maintenance noise.
Risk: confusion and accidental reactivation of stale patterns.
Recommendation: remove or gate behind dev-only flags.
Architecture Review
Overall architecture assessment
Good: clear layering (schemas -> services -> routers -> UI), tRPC type flow, Prisma data layer, and dedicated Solana integration modules.
Current risk: secret-handling policy violates custody-grade requirements. Architecture is functionally modern but security posture is not production-safe.
Scalability bottlenecks
Single-process in-memory orchestration for volume-bot timers/caches; not horizontally safe.
Missing critical DB indexes on high-volume filters.
Serial webhook invalidation and chatty update loops.
Very large service modules (launch/exit/volume worker) reduce safe iteration velocity.
Single points of failure
Central PostgreSQL instance (no resilience strategy shown).
Single logical RPC/gRPC dependency paths for core flows.
In-memory timer/state managers (volumeBotTimer, grpc state) tied to process lifecycle.
Plaintext key storage as a catastrophic compromise point.
Positive Findings (keep these)
Service-layer ownership checks are generally strong (many token.findFirst({ publicKey, userId }) patterns).
tRPC protectedProcedure usage is widespread across financial endpoints.
Jito bundle flow has robust retry + confirmation fallback logic (jito-bundle.ts).
Caching includes bounded maps in key paths (e.g., stats cache max size, bonding-curve cache max size).
Volume-bot schemas enforce meaningful numeric constraints (ranges, durations, concurrency bounds).
Refresh cache model and touch flow are a good foundation for freshness-aware UX.
Feature Roadmap
CRITICAL (blocks production)
Security & Trust

1. Name: Custody-Grade Key Vault + Signer Service

Priority: CRITICAL
Effort: XL
Impact: Eliminates largest existential security risk (key compromise blast radius).
Dependencies: KMS/HSM integration, schema migration plan.
Brief Description: Encrypt all private keys at rest (envelope encryption), isolate decrypt/sign in a signer service, and remove direct key access from app/query layers. 2) Name: Remove All Key Egress APIs/UI

Priority: CRITICAL
Effort: M
Impact: Prevents browser/session/XSS key exfiltration.
Dependencies: Signer service endpoint contracts.
Brief Description: Delete wallet.getPrivateKey, wallet.getMainPrivateKey, key-display dialogs, and sanitize token responses to never include privateKey fields. 3) Name: Dangerous Route Shutdown + Prod Route Policy

Priority: CRITICAL
Effort: S
Impact: Immediate removal of active fund-drain and abuse routes.
Dependencies: none.
Brief Description: Remove /api/wallets/refresh, remove public test router in production, and formalize API route allowlist with tests.
Infrastructure & Technical Foundation 4) Name: Financial Job Idempotency + DB Locks

Priority: CRITICAL
Effort: M
Impact: Prevents duplicate launches/exits/sessions and double-funding races.
Dependencies: schema updates (unique constraints/locks).
Brief Description: Add idempotency keys and transactional locking for launch, exit, and volume-bot start flows. 5) Name: Session/Auth Hardening

Priority: CRITICAL
Effort: S
Impact: Reduces token forgery and long-lived hijack risk.
Dependencies: env policy + migration window.
Brief Description: Require JWT secret at startup, reduce token lifetime, add refresh-token rotation and forced logout capability.
HIGH (next sprint)
Security & Trust 6) Name: Webhook Security Gateway

Priority: HIGH
Effort: M
Impact: Prevents spoof/replay/DoS on ingestion path.
Dependencies: route policy update.
Brief Description: Require signed webhook auth in prod, add timestamp nonce replay cache, and ensure webhook path bypasses auth proxy correctly. 7) Name: API Rate Limiting + Abuse Controls

Priority: HIGH
Effort: M
Impact: Protects DB/RPC from endpoint abuse.
Dependencies: centralized middleware.
Brief Description: Add per-IP/per-user rate limits for auth, tRPC mutations, and webhook ingest; include circuit breakers for downstream RPC strain.
Infrastructure & Operations 8) Name: Durable Queue + Worker Extraction

Priority: HIGH
Effort: L
Impact: Improves resilience and horizontal scalability.
Dependencies: idempotency model.
Brief Description: Move launch/exit/bot orchestration from in-memory execution to durable queue workers with retries and dead-lettering. 9) Name: Observability Baseline (Health, Metrics, Traces, Alerts)

Priority: HIGH
Effort: M
Impact: Faster incident detection/recovery for financial operations.
Dependencies: logging standardization.
Brief Description: Add /health + /ready, OpenTelemetry traces, Prometheus-style metrics, and alerting for gRPC disconnect, failed bundles, stale sessions.
Solana / Trading 10) Name: Risk Guardrails Engine

Priority: HIGH
Effort: M
Impact: Reduces bad execution and MEV losses.
Dependencies: config/schema updates.
Brief Description: Enforce bounded slippage defaults, max tip ratios, trade sanity checks, and failure cutoffs before transaction submission.
Database 11) Name: Query/Schema Hardening Pack

Priority: HIGH
Effort: M
Impact: Improves p95 latency and consistency.
Dependencies: migration plan.
Brief Description: Add missing indexes, add holding uniqueness constraints, and introduce migration safety checks for destructive changes.
MEDIUM (roadmap)
Trading & Automation 12) Name: Strategy Engine v2 (TWAP, inventory bands, adaptive intervals)

Priority: MEDIUM
Effort: L
Impact: Competitive edge for volume bot performance.
Dependencies: durable worker architecture.
Brief Description: Expand beyond random range trading to strategy modules with guardrails and per-session policy profiles. 13) Name: PnL & Attribution Analytics

Priority: MEDIUM
Effort: M
Impact: Better user decision-making and premium feature base.
Dependencies: clean transaction/holding integrity.
Brief Description: Add realized/unrealized PnL, fee attribution, execution quality, and wallet-level performance dashboards.
Ecosystem & Integrations 14) Name: Multi-DEX Execution Layer (Jupiter/Raydium/Orca)

Priority: MEDIUM
Effort: L
Impact: Better execution quality and ecosystem relevance.
Dependencies: signer/risk engine.
Brief Description: Route trades via multiple liquidity sources with fallback and quote-comparison logic. 15) Name: External Market Intelligence Integration

Priority: MEDIUM
Effort: M
Impact: Better launch and bot parameterization.
Dependencies: analytics data model.
Brief Description: Integrate Birdeye/DexScreener/social signals for smarter defaults and alerts.
UX & Product 16) Name: Real-Time Alerting Center

Priority: MEDIUM
Effort: M
Impact: Trust and operational clarity.
Dependencies: observability baseline.
Brief Description: In-app + webhook notifications for trade failures, low balances, session state changes, and launch milestones.
LOW (nice-to-have)
Monetization & Product 17) Name: Tiered Plans + Usage Metering

Priority: LOW
Effort: L
Impact: Sustainable revenue foundation.
Dependencies: analytics and rate-limiting infrastructure.
Brief Description: Introduce plan-based limits (wallets/sessions/API throughput), premium analytics, and billing hooks. 18) Name: Guided Onboarding + Safety Academy

Priority: LOW
Effort: M
Impact: Reduced user error and support load.
Dependencies: key-egress removal and risk guardrails.
Brief Description: Add guided setup, wallet risk education, and best-practice presets for safer first-time usage.
Suggested implementation order (dependency-aware)
Immediate hotfixes: remove /api/wallets/refresh, strip key-returning APIs/UI, disable public test routes in prod.
Secret/auth foundation: mandatory JWT/env hardening + route policy (including webhook allowlist).
Data integrity: idempotency locks + holding uniqueness/index migrations.
Abuse & reliability: webhook security gateway + API rate limiting + health/metrics.
Scalability: durable queue/workers and memory-bound cache structures.
Product expansion: strategy engine, analytics, integrations, monetization.
If you want, I can move directly into a remediation PR sequence (starting with the 5 critical blockers) and implement them in safe, reviewable commits.
