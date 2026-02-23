In-Depth Performance Analysis: Transaction & Holding Refresh
Architecture Overview
The refresh flow works like this:
User clicks Refresh (or auto-refresh fires after 60s stale) → Frontend calls tRPC mutation (refreshByToken) → Service fetches signatures from Solana RPC (per wallet, sequentially) → Service fetches parsed transactions from RPC (batched by 20) → Service diffs against DB (existing transactions via IN query) → Service writes new rows (createMany) + updates stale rows (N individual UPDATEs) → Frontend calls refetch on listByToken query → Service returns ALL transactions (no pagination, no limit) → Client renders DataTable with client-side pagination
CRITICAL: Missing Database Indexes
The single biggest issue. Looking at the schema:
schema.prisma
Lines 360-378
model Transaction { id String @id @default(cuid()) walletPublicKey String wallet Wallet @relation("WalletTransactions", fields: [walletPublicKey], references: [publicKey]) tokenPublicKey String token Token @relation("TokenTransactions", fields: [tokenPublicKey], references: [publicKey]) transactionType TransactionType status TransactionStatus transactionSignature String solAmount Decimal tokenAmount Decimal pricePerToken Decimal slippageBps Int feeAmount Decimal blockTime DateTime? createdAt DateTime @default(now()) updatedAt DateTime @updatedAt @@map("Transaction")}
Zero @@index declarations. Every query hitting this table does a sequential scan. Same for Holding:
schema.prisma
Lines 321-339
model Holding { id String @id @default(cuid()) walletPublicKey String tokenPublicKey String tokenBalance Decimal totalBuyAmount Decimal totalSellAmount Decimal averageBuyPrice Decimal lastTransactionSignature String lastUpdated DateTime @default(now()) createdAt DateTime @default(now()) // ... relations ... @@map("Holding")}
Also zero indexes. With 100+ transactions, every query against these tables is a full table scan.
Bottleneck #1: Sequential RPC Calls Per Wallet (Transaction Refresh)
transaction.service.ts
Lines 405-422
for (const wallet of wallets) { const walletPublicKey = new PublicKey(wallet.publicKey); const signatures = await connection.getSignaturesForAddress( walletPublicKey, { limit: signatureLimit } ); signatures.forEach((signatureInfo) => { const existing = signatureWallets.get(signatureInfo.signature); if (existing) { existing.add(wallet.publicKey); } else { signatureWallets.set( signatureInfo.signature, new Set([wallet.publicKey]) ); } }); }
This is a sequential for loop making one RPC call per wallet. With a token that has a main wallet + dev wallet + N bundler/volume/distribution wallets, each call takes 200-500ms. 10 wallets = 2-5 seconds just for signature fetching.
Bottleneck #2: No Server-Side Pagination (listByToken)
transaction.service.ts
Lines 377-390
return await prisma.transaction.findMany({ where: { tokenPublicKey: input.tokenPublicKey, ...(input.walletPublicKey ? { walletPublicKey: input.walletPublicKey } : {}), }, include: { wallet: { select: { publicKey: true, type: true }, }, }, orderBy: { createdAt: "desc" }, });
No take, no skip. Returns every single transaction for the token. With 100+ rows and no index on (tokenPublicKey, createdAt), this query is:
Full table scan to find matching tokenPublicKey
Sort all results by createdAt
Serialize and transfer the entire result set over the wire
Client only displays 10 rows per page anyway
Bottleneck #3: N Individual DB Updates During Refresh
transaction.service.ts
Lines 597-605
if (updates.length > 0) { await prisma.$transaction(        updates.map((update) =>          prisma.transaction.update({            where: { id: update.id },            data: update.data,          })        )      );    }
Each update is a separate SQL statement wrapped in a transaction. With 50 stale transactions needing price updates, that's 50 individual UPDATE statements.
Bottleneck #4: Holding Refresh - N Individual Writes
holding.service.ts
Lines 314-373
    const updateResults = await Promise.all(      balanceResults.map(async ({ wallet, tokenBalance, ataExists }) => {        // ...        if (tokenBalance > 0 || ataExists) {          if (existingId) {            return prisma.holding.update({              where: { id: existingId },              data: {                tokenBalance,                totalBuyAmount,                totalSellAmount,                averageBuyPrice,                lastTransactionSignature: lastTxSignature,                lastUpdated: now,                // ...              },            });          }          return prisma.holding.create({            data: { /* ... */ },          });        }        if (existingId) {          await prisma.holding.delete({ where: { id: existingId } });        }        return null;      })    );
Promise.all with N individual create/update/delete calls. Each is a separate round-trip to the database. With 20 wallets, that's 20 parallel DB connections being consumed.
Bottleneck #5: DISTINCT ON Raw Query Without Index
holding.service.ts
Lines 265-275
        prisma.$queryRaw< Array<{ walletPublicKey: string; transactionSignature: string }> >`          SELECT DISTINCT ON ("walletPublicKey")             "walletPublicKey",             "transactionSignature"          FROM "Transaction"          WHERE "walletPublicKey" = ANY(${walletPublicKeys})            AND "tokenPublicKey" = ${token.publicKey}          ORDER BY "walletPublicKey", "createdAt" DESC        `,
DISTINCT ON requires sorting all matching rows. Without an index on (walletPublicKey, tokenPublicKey, createdAt DESC), PostgreSQL must:
Seq scan the entire Transaction table
Filter matches
Sort by walletPublicKey, createdAt DESC
Deduplicate
Bottleneck #6: groupBy Without Index
holding.service.ts
Lines 257-264
prisma.transaction.groupBy({ by: ["walletPublicKey", "transactionType"], where: { walletPublicKey: { in: walletPublicKeys }, tokenPublicKey: token.publicKey, }, \_sum: { solAmount: true, tokenAmount: true }, }),
A GROUP BY on walletPublicKey, transactionType with a WHERE on tokenPublicKey. Without an index covering (tokenPublicKey, walletPublicKey, transactionType), this is another full scan + hash aggregate.
Bottleneck #7: Auto-Refresh Triggers Full Pipeline
page.tsx
Lines 97-115
useEffect(() => { if (!tokenPublicKey || !tokenData) return; if (refreshCacheLoading) return; if (isRefreshing) return; const isStale = !refreshTimestamp || Date.now() - new Date(refreshTimestamp).getTime() >= cacheConfig.staleMs.transactions; if (!isStale) return; if (autoRefreshTriggered.current) return; autoRefreshTriggered.current = true; void handleRefresh({ showToast: false }); }, [/* ... */]);
With a 60-second stale window, every time you navigate to the transactions page, if data is >60s old, it fires the entire refresh pipeline: RPC calls + DB writes + full re-fetch. The handleRefresh does:
page.tsx
Lines 81-83
await refreshTransactions({ tokenPublicKey }); await Promise.all([refetchTransactions(), refetchRefreshCache()]);
That's: mutation (all the RPC + DB work) → then a full re-list of all transactions → then a re-fetch of the cache timestamp. Three sequential network operations.
Bottleneck #8: Stale Transaction Re-fetch
transaction.service.ts
Lines 424-432
const staleTransactions = await prisma.transaction.findMany({ where: { tokenPublicKey: token.publicKey, walletPublicKey: { in: walletPublicKeys }, OR: [{ pricePerToken: 0 }, { solAmount: 0 }], }, select: { transactionSignature: true, walletPublicKey: true }, orderBy: { updatedAt: "desc" }, take: 200, });
The OR with pricePerToken: 0 / solAmount: 0 combined with no index means PostgreSQL has to scan every transaction, check if price is 0 OR sol is 0, then sort by updatedAt. Up to 200 rows fetched, each requiring a re-parse from RPC.
Summary: What Happens With 100+ Transactions
When a user with 10 wallets and 150 transactions navigates to the Transactions page:
Step Operation Without Indexes Estimated Time
1 Auto-refresh detects stale (>60s) - instant
2 getSignaturesForAddress × 10 wallets (sequential) - 2-5s
3 Fetch stale transactions (full scan, OR filter) Seq scan 100-500ms
4 getParsedTransactions in batches of 20 - 2-8s
5 Find existing transactions (IN query, no index) Seq scan 100-500ms
6 createMany + N individual updates N round-trips 200-1000ms
7 listByToken returns ALL 150 rows (no index on sort) Seq scan + sort 200-1000ms
8 Client renders + processes all 150 rows - 50-200ms
Total ~5-16 seconds
Then for holdings refresh (triggered separately or from holdings page):
Step Operation Without Indexes Estimated Time
1 Fetch wallet ATAs + RPC balances Batched RPC 500-2000ms
2 groupBy on Transaction (no index) Full scan + hash agg 200-1000ms
3 DISTINCT ON raw query (no index) Full scan + sort 200-1000ms
4 Fetch existing holdings (no index) Seq scan 50-200ms
5 N individual update/create/delete N round-trips 200-1000ms
Total ~1-5 seconds
Recommended Fixes (Priority Order)

1. Add indexes (immediate, biggest impact):
   model Transaction { // ... fields ... @@index([tokenPublicKey, createdAt]) @@index([tokenPublicKey, walletPublicKey, createdAt]) @@index([tokenPublicKey, transactionSignature, walletPublicKey]) @@index([walletPublicKey, tokenPublicKey, updatedAt])}model Holding { // ... fields ... @@index([tokenPublicKey, walletPublicKey]) @@index([tokenPublicKey, lastUpdated])}
2. Add server-side pagination to listByToken - accept take/skip params, return only the page the user is viewing.
3. Parallelize wallet signature fetches - replace the sequential for loop with Promise.all or controlled concurrency (e.g., 3 at a time).
4. Batch the individual holding writes - use createMany + a single raw UPDATE ... FROM VALUES instead of N individual Prisma calls.
5. Add a unique constraint on Transaction - @@unique([tokenPublicKey, transactionSignature, walletPublicKey]) to replace the manual dedup logic and enable upsert.
6. Increase the stale window or make refresh opt-in only, so navigating between pages doesn't trigger the full pipeline every time.
