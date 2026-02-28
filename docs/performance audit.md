Executive summary (highest impact)
Index gaps are real and material: Wallet.tokenPublicKey, Token.userId, and RefreshCache.lastRefreshedAt are not indexed (prisma/schema.prisma:45,86,465).
Dashboard is the heaviest path: one dashboard.getStats call fans out into many DB + RPC operations, including a 5,000-row transaction scan each call (server/services/dashboard.service.ts:369-384).
Unbounded list endpoints remain: token.getUserTokens and wallet.getOperationalByToken have no pagination (server/services/token.service.ts:24-27, server/services/wallet.service.ts:36-49).
RPC timeout coverage is inconsistent: some calls have timeout guards, many do not (notably getParsedTransactions, sendAndConfirmTransaction, holder lookups).
Sell path can overwhelm RPC: holding.sellByToken uses unbounded Promise.all over wallets (server/services/holding.service.ts:644-720).
Cache strategy is mostly per-process and short-lived (dashboard/price/holders), so horizontal scale gets little cache benefit.
Polling + broad invalidations add avoidable load (especially volume bot pages and wallet transfer invalidations).
No major classic read-side N+1 in target functions, but several N-write patterns and sequential lookup patterns still add latency.

1. Database & Query Performance
   Index audit (requested)
   Missing Wallet.tokenPublicKey index (prisma/schema.prisma:45).
   Missing Token.userId index (prisma/schema.prisma:86).
   Missing RefreshCache.lastRefreshedAt index (prisma/schema.prisma:465).
   Brief suggestions

Add @@index([tokenPublicKey, type]) (or at least [tokenPublicKey]) on Wallet.
Add @@index([userId, createdAt]) on Token.
Add @@index([lastRefreshedAt]) on RefreshCache if you plan time-based sweeps/cleanup.
N+1 patterns (requested focus files)
No strong classic read N+1 in dashboard.getHoldingsBreakdown (wallet relation is included in one query: server/services/dashboard.service.ts:187-197).
Sequential lookup chains in wallet services:
getWalletByToken: token -> user -> wallet -> optional dev link (server/services/wallet.service.ts:180-255)
getWalletPrivateKey: similar chain (server/services/wallet.service.ts:281-339)
N-write style updates:
holdings batch does many per-row updates (server/services/holding.service.ts:596-603)
transactions stale-fix does many per-row updates (server/services/transaction.service.ts:700-708)
Brief suggestions

Batch independent ownership checks with Promise.all.
Replace per-row update loops with chunked bulk SQL/upsert patterns where possible.
Unbounded result sets
token.getUserTokens unpaginated (server/services/token.service.ts:24-27)
token.getAllUserTokens unpaginated (server/services/token.service.ts:47-50)
wallet.getOperationalByToken unpaginated (server/services/wallet.service.ts:36-49)
dashboard.getPriceHistory hard-capped but still large (take: 5000) (server/services/dashboard.service.ts:383)
Brief suggestions

Add pagination/cursor for token and wallet list endpoints.
Reduce price-history payload (windowing/downsampling server-side).
Raw SQL optimization opportunities
holding.service DISTINCT ON latest tx per wallet (server/services/holding.service.ts:461-471) can become expensive as table grows.
dashboard.service recent tx DISTINCT ON with ordering logic (server/services/dashboard.service.ts:324-366) is sort-heavy.
transaction.listByToken grouped DISTINCT ON + COUNT(DISTINCT ...) (server/services/transaction.service.ts:379-420) is heavy at scale.
Brief suggestions

Add token-first composite indexes aligned to these ORDER BY patterns.
Consider pre-aggregated “latest-by-signature/latest-by-wallet” helper tables/materialization.

2. On-Chain Data Fetching (Solana RPC)
   Transaction service
   Refresh windows are fixed: latest 300 + stale 200 (server/services/transaction.service.ts:734-749), and source signatures capped at 120 per source (:221-237).
   Good: getTokenSourceSignatures has timeout (rpcTimeoutMs + Promise.race) (:224-243).
   Gap: getParsedTransactions calls in ingestion have no explicit timeout wrapper (:532-536).
   Brief suggestions

Move to cursor-based incremental ingest (last signature/slot), not fixed windows.
Add timeout+retry wrapper around parsed tx fetches.
Holding service
Refresh batching is decent (HOLDING_RPC_BATCH_SIZE=100, concurrency=3) (server/services/holding.service.ts:44-46, 313-321).
sellByToken uses unbounded concurrency (Promise.all on all wallets) (:644-720).
Brief suggestions

Add bounded concurrency for sell submissions (e.g., 3–10 workers).
Wallet service
refreshWalletBalances batch size scales reasonably at ~100 wallets (server/services/wallet.service.ts:461-475), but batches are sequential.
Transfer concurrency fixed at 5 (:574, :756) — safe, but slow for very large wallet sets.
Many tx/balance RPC calls have no hard timeout around sendAndConfirmTransaction, getBalance, getLatestBlockhash.
Brief suggestions

Make transfer concurrency configurable/adaptive.
Add hard timeouts for long-tail RPC/confirm calls.
RPC re-fetch inefficiency
holding.listByToken fetches token supply from RPC on every paginated query (server/services/holding.service.ts:391-400).
Brief suggestion

Cache token supply per mint (short TTL).

3. Caching Strategy
   Dashboard cache: 50 entries, 10s TTL (server/services/dashboard.service.ts:18,24,542-545).
   Price cache: 200 entries, 10–30s TTL (server/services/price.service.ts:78-80,158-160,213-216).
   Holders cache: 15s TTL, in-memory (server/services/holders.service.ts:19-20).
   All are process-local (no Redis/shared layer).
   RefreshCache adds DB read + upsert traffic (server/services/refresh-cache.service.ts:14-43) and is queried on multiple pages.
   Cooldown config exists for holdings/transactions subscription modes but appears unused (lib/config/cache.config.ts:9,11,13; wallet cooldown only used at wallet.service.ts:417).
   Brief suggestions

Add shared cache (Redis) first for: dashboard.getStats, price/holder snapshots, token lists.
Either fully use cooldowns for holdings/transactions refresh paths, or remove dead config.
Revisit RefreshCache round-trip cost vs deriving staleness from domain tables.

4. Frontend Data Fetching Patterns
   Polling load
   Dashboard stats/defi: every 30s (app/(app)/[tokenPublicKey]/dashboard/dashboard-client.tsx:90,99)
   Exit status: every 2s while active (dashboard-client.tsx:262-267, holdings/page.tsx:95-100)
   Volume bot new status: every 10s (volume-bot/new/page.tsx:303)
   Volume bot run status + logs: every 5s (volume-bot/[sessionId]/page.tsx:82,92)
   Launch status: every 2s while running (launch-form.tsx:203-208)
   Redundant/broad refetch behavior
   Broad invalidations without scoped params:
   wallet-transfer-dialog: invalidates all wallet queries (components/wallets/wallet-transfer-dialog.tsx:169-171)
   transactions/holdings pages invalidate list queries broadly (transactions/page.tsx:187, holdings/page.tsx:175)
   wallet detail page invalidates all holdings/tx lists (wallets/[walletPublicKey]/page.tsx:234,251)
   token.getUserTokens called in multiple places (client + server), with unpaginated backend.
   Brief suggestions

Scope invalidations by tokenPublicKey wherever possible.
Stop/slow polling after terminal states (especially volume bot run page).
Consolidate token list source and avoid repeated full-list fetches.

5. Scalability bottlenecks for 100+ wallets / 10,000+ tx
   Critical path trace: dashboard
   dashboard.getStats (30s polling + event-driven refetch) triggers multi-query fan-out: token auth check, header fetches, wallet key resolution, treasury aggregates, volume group-bys, holdings aggregate/list, volume-bot sessions, recent tx SQL, and potentially 5,000-row price history scan (server/services/dashboard.service.ts:413-449).
   Bottleneck: repeated heavy reads + external RPC; in-memory cache TTL (10s) is shorter than poll interval, so hit rate is limited.

Critical path trace: transaction refresh
transaction.refreshByToken reads latest+stale DB rows, fetches signatures, parses tx batches, diffs against DB, writes creates/updates, then UI invalidates/refetches list (server/services/transaction.service.ts:723-773).
Bottlenecks: fixed windows can miss high-throughput periods; stale-row query pattern can degrade without better indexing; many per-row updates.

Critical path trace: sell across many wallets
holding.sellByToken launches all wallet sells concurrently via Promise.all (server/services/holding.service.ts:644-720).
Bottleneck: RPC saturation and long-tail failures/timeouts at scale.

Hidden O(n²)/worse patterns
walletPublicKeys.includes(...) filters in allowed-wallet helpers (holding.service.ts:92, transaction.service.ts:199) -> O(n\*m).
stale signature dedupe via signatures.includes(...) in loop (transaction.service.ts:762) -> O(n²) in that segment.
These are secondary vs DB/RPC hotspots, but easy wins.
Brief suggestions

Replace includes hot paths with Set membership.
Add bounded worker pools for all wallet-wide mutations.
Introduce incremental, cursor-based ingest and downsampled dashboard history payloads.
Recommended priority order (short)
Indexes first: wallet/token + stale-token-transaction query index strategy.
Bound RPC fan-out: especially sellByToken; add hard timeouts to parse/confirm paths.
Reduce dashboard payload/work: shrink/downsample price history and cache stats in shared cache.
Paginate token/wallet list endpoints + select minimal fields.
Scope query invalidations + stop unnecessary polling (volume bot terminal states).
Use or remove unused cooldown knobs; align backend refresh throttling with config.
If you want, I can provide a concrete “implementation backlog” sorted by effort vs impact (no code changes, just a step-by-step optimization plan).
