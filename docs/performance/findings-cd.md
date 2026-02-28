The key pattern is: both refresh paths do full-table style work against Transaction, and the transactions page also pulls all rows at once with client-side rendering/filtering.
How refresh currently works
Transactions refresh path
UI triggers refresh via trpc.transaction.refreshByToken (manual and auto-when-stale).
Server flow:

1. Resolve allowed wallets
2. For each wallet, fetch last 100 signatures from Solana RPC
3. Add stale DB rows (pricePerToken=0 or solAmount=0)
4. Parse signatures in batches (20)
5. Query existing rows by signature+wallet
6. createMany new rows + per-row update for stale rows
7. Touch refresh cache timestamp
   page.tsx
   Lines 97-109
   useEffect(() => { if (!tokenPublicKey || !tokenData) return; if (refreshCacheLoading) return; if (isRefreshing) return; const isStale = !refreshTimestamp || Date.now() - new Date(refreshTimestamp).getTime() >= cacheConfig.staleMs.transactions; if (!isStale) return; if (autoRefreshTriggered.current) return; autoRefreshTriggered.current = true; void handleRefresh({ showToast: false }); }, [
   transaction.service.ts
   Lines 405-410
   for (const wallet of wallets) { const walletPublicKey = new PublicKey(wallet.publicKey); const signatures = await connection.getSignaturesForAddress( walletPublicKey, { limit: signatureLimit } );
   transaction.service.ts
   Lines 597-605
   if (updates.length > 0) { await prisma.$transaction( updates.map((update) => prisma.transaction.update({ where: { id: update.id }, data: update.data, }) ) );
   Holdings refresh path
   UI triggers trpc.holding.refreshByToken (manual and stale auto-refresh).
   Server flow:
8. Resolve allowed wallets
9. Fetch all ATAs + balances for those wallets
10. Query transaction aggregates via groupBy
11. Query latest tx signature per wallet via DISTINCT ON raw SQL
12. Upsert/delete holdings wallet-by-wallet
13. Touch holdings refresh cache
    holding.service.ts
    Lines 255-275
    const [transactionAggregates, lastTransactions, existingHoldings] = await Promise.all([ prisma.transaction.groupBy({ by: ["walletPublicKey", "transactionType"], where: { walletPublicKey: { in: walletPublicKeys }, tokenPublicKey: token.publicKey, }, \_sum: { solAmount: true, tokenAmount: true }, }), prisma.$queryRaw< Array<{ walletPublicKey: string; transactionSignature: string }> >` SELECT DISTINCT ON ("walletPublicKey") "walletPublicKey", "transactionSignature" FROM "Transaction"
    holding.service.ts
    Lines 313-373
    const now = new Date(); const updateResults = await Promise.all( balanceResults.map(async ({ wallet, tokenBalance, ataExists }) => { // ... per-wallet create/update/delete ... }) );
    Why it slows down past ~100 transactions
14. Transactions list endpoint returns everything (no pagination)
    listByToken fetches all rows for token and sorts descending.
    UI table then handles larger arrays client-side (filters/search/rendering).
    transaction.service.ts
    Lines 377-390
    return await prisma.transaction.findMany({ where: { tokenPublicKey: input.tokenPublicKey, ...(input.walletPublicKey ? { walletPublicKey: input.walletPublicKey } : {}), }, include: { wallet: { select: { publicKey: true, type: true }, }, }, orderBy: { createdAt: "desc" }, });
15. Holdings refresh scales with transaction table size
    Every holdings refresh runs:
    groupBy over token transactions
    DISTINCT ON ... ORDER BY createdAt DESC for latest tx per wallet
    As Transaction grows, these become much heavier.
16. Refresh write/update strategy is expensive under load
    Stale row fixing does per-row updates in a single $transaction array, which still means many update statements.
    Signature discovery is sequential per wallet (await inside loop), increasing refresh duration as wallets/signatures grow.
17. Very likely missing DB indexes for this workload
    In your current schema.prisma, Transaction/Holding show no model-level indexes/uniques for frequent filters/sorts (tokenPublicKey, walletPublicKey, createdAt, transactionSignature).
    If DB truly mirrors schema, scans/sorts will degrade quickly.
    schema.prisma
    Lines 360-378
    model Transaction { id String @id @default(cuid()) walletPublicKey String wallet Wallet @relation("WalletTransactions", fields: [walletPublicKey], references: [publicKey]) tokenPublicKey String token Token @relation("TokenTransactions", fields: [tokenPublicKey], references: [publicKey]) transactionType TransactionType status TransactionStatus transactionSignature String // ... createdAt DateTime @default(now()) updatedAt DateTime @updatedAt @@map("Transaction")}
    High-confidence bottlenecks (ranked)
    P1: Unpaginated transaction.listByToken + client-side DataTable on full dataset.
    P1: Holdings refresh transaction aggregations (groupBy + DISTINCT ON) executed every refresh.
    P1/P2: Missing practical indexes on Transaction query paths.
    P2: Per-row update loop for stale transaction rows.
    P2: Sequential wallet signature RPC loop in transactions refresh.
    What to do next (fastest wins)
    Add server pagination/cursor to transaction.listByToken; do not return entire history.
    Add indexes for dominant filters/sorts (at minimum around tokenPublicKey, walletPublicKey, createdAt, and signature lookup patterns).
    Replace stale update loop with chunked/bulk strategy.
    Reduce holdings refresh frequency or make it incremental (only changed wallets/signatures).
    Add query timing + EXPLAIN ANALYZE for:
    transactions list query
    holdings groupBy
    holdings DISTINCT ON query
    If you want, I can produce a concrete optimization patch set in priority order (schema indexes + paginated API + minimal UI changes) and keep behavior unchanged.
