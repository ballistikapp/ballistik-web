# Transaction & Holding Refresh — Performance Optimization Plan

## Problem Summary

The application slows down significantly when a token has more than ~100 transactions. Both refresh paths do full-table work against the `Transaction` table, and the list endpoints return all rows with client-side pagination.

### Root Causes

1. **Zero indexes** on `Transaction` and `Holding` models — every query is a sequential scan.
2. **No server-side pagination** — `listByToken` returns the entire history; the client paginates locally.
3. **Sequential RPC calls** — signature discovery loops through wallets one at a time.
4. **Per-row write patterns** — stale transaction updates and holding upserts issue N individual statements.
5. **Aggressive auto-refresh** — 60-second stale window triggers the full pipeline on every page visit.

### Current Refresh Flow

**Transactions:**

```
UI auto-refresh (stale > 60s) or manual button
  → refreshByToken mutation
    → resolve allowed wallets
    → for each wallet: getSignaturesForAddress (sequential, 100 per wallet)
    → fetch stale DB rows (pricePerToken=0 or solAmount=0, up to 200)
    → getParsedTransactions in batches of 20
    → find existing rows by signature+wallet (IN query)
    → createMany new rows + N individual updates for stale rows
    → touch refresh cache
  → refetch listByToken (returns ALL rows, no limit)
  → client renders DataTable with client-side pagination
```

**Holdings:**

```
UI auto-refresh (stale > 60s) or manual button
  → refreshByToken mutation
    → resolve allowed wallets
    → fetch ATAs + balances via getMultipleParsedAccounts (batched by 100)
    → parallel DB queries:
        - transaction.groupBy (walletPublicKey, transactionType) for aggregates
        - DISTINCT ON raw SQL for latest tx signature per wallet
        - holding.findMany for existing holdings
    → N individual create/update/delete per wallet via Promise.all
    → touch refresh cache
  → refetch listByToken (returns all holdings)
```

---

## Phase 1: Indexes + Pagination + Bounded RPC Concurrency

Low risk, biggest impact. All three changes are independent.

### 1a. Database Indexes

Add to `prisma/schema.prisma`:

```prisma
model Transaction {
  // ... existing fields ...

  @@index([tokenPublicKey, createdAt])
  @@index([tokenPublicKey, walletPublicKey, createdAt])
  @@index([tokenPublicKey, transactionSignature, walletPublicKey])
  @@map("Transaction")
}

model Holding {
  // ... existing fields ...

  @@index([tokenPublicKey, walletPublicKey])
  @@index([tokenPublicKey, lastUpdated])
  @@map("Holding")
}
```

**What each index covers:**

| Index                                                                | Queries it accelerates                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| `Transaction(tokenPublicKey, createdAt)`                             | `listByToken` ORDER BY createdAt DESC                         |
| `Transaction(tokenPublicKey, walletPublicKey, createdAt)`            | Holdings `groupBy`, `DISTINCT ON` raw query, stale row lookup |
| `Transaction(tokenPublicKey, transactionSignature, walletPublicKey)` | Existing-row lookup during refresh (the IN query)             |
| `Holding(tokenPublicKey, walletPublicKey)`                           | `findMany` in holding refresh, list queries                   |
| `Holding(tokenPublicKey, lastUpdated)`                               | `listByToken` ORDER BY lastUpdated DESC                       |

**Effort:** Schema change + migration only. Zero application code changes.

**Validation:** After migration, run `EXPLAIN ANALYZE` on:

- `SELECT * FROM "Transaction" WHERE "tokenPublicKey" = $1 ORDER BY "createdAt" DESC LIMIT 10`
- `SELECT ... GROUP BY "walletPublicKey", "transactionType" WHERE "tokenPublicKey" = $1`
- `SELECT DISTINCT ON ("walletPublicKey") ... FROM "Transaction" WHERE "walletPublicKey" = ANY($1) AND "tokenPublicKey" = $2 ORDER BY "walletPublicKey", "createdAt" DESC`

Confirm all show Index Scan or Index Only Scan, not Seq Scan.

### 1b. Server-Side Pagination on `listByToken`

**Schema changes** (`server/schemas/transaction.schema.ts` and `holding.schema.ts`):

Add optional `page` (default 1) and `pageSize` (default 10, max 100) to both list schemas.

**Service changes** (`transaction.service.ts` and `holding.service.ts`):

In `listByToken`, add `take`/`skip` and a parallel `count` query:

```typescript
const skip = ((page ?? 1) - 1) * (pageSize ?? 10);
const take = pageSize ?? 10;

const [items, totalCount] = await Promise.all([
  prisma.transaction.findMany({
    where: { tokenPublicKey: input.tokenPublicKey, ... },
    include: { wallet: { select: { publicKey: true, type: true } } },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  }),
  prisma.transaction.count({
    where: { tokenPublicKey: input.tokenPublicKey, ... },
  }),
]);

return { items, totalCount };
```

For holdings, also return `totalBalance` as a server-side aggregate (used by the Exit dialog):

```typescript
const [items, totalCount, balanceAgg] = await Promise.all([
  prisma.holding.findMany({ ... skip, take }),
  prisma.holding.count({ ... }),
  prisma.holding.aggregate({
    where: { tokenPublicKey: input.tokenPublicKey },
    _sum: { tokenBalance: true },
  }),
]);

return { items, totalCount, totalBalance: Number(balanceAgg._sum.tokenBalance ?? 0) };
```

**Frontend changes** (`transactions/page.tsx` and `holdings/page.tsx`):

Pass `page`/`pageSize` from DataTable's pagination state into the tRPC query. Set `manualPagination: true` and `pageCount` from `totalCount / pageSize` on the TanStack Table instance.

**What doesn't change:**

- Refresh mutations (they write to DB, don't read lists)
- Dashboard (doesn't use listByToken)
- Holdings metrics (totalBalance now comes from the server response)
- Any other service or router

### 1c. Bounded Concurrency on Wallet Signature Fetch

**Current code** (`transaction.service.ts` lines 405-422):

```typescript
for (const wallet of wallets) {
  const walletPublicKey = new PublicKey(wallet.publicKey);
  const signatures = await connection.getSignaturesForAddress(walletPublicKey, {
    limit: signatureLimit,
  });
  // ... merge into signatureWallets map
}
```

Sequential `for...of` with `await` inside. Each wallet waits for the previous one to finish.

**Replacement** using existing `mapWithConcurrency` from `lib/utils/async.ts`:

```typescript
const RPC_CONCURRENCY = 3;
const RPC_TIMEOUT_MS = 10_000;

const walletSignatures = await mapWithConcurrency(
  wallets,
  RPC_CONCURRENCY,
  async (wallet) => {
    const walletPk = new PublicKey(wallet.publicKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
      const sigs = await connection.getSignaturesForAddress(walletPk, {
        limit: signatureLimit,
      });
      return { wallet: wallet.publicKey, signatures: sigs };
    } catch {
      return { wallet: wallet.publicKey, signatures: [] };
    } finally {
      clearTimeout(timeout);
    }
  }
);

for (const { wallet, signatures } of walletSignatures) {
  for (const sig of signatures) {
    const existing = signatureWallets.get(sig.signature);
    if (existing) {
      existing.add(wallet);
    } else {
      signatureWallets.set(sig.signature, new Set([wallet]));
    }
  }
}
```

**What changes:**

- RPC calls run 3 at a time instead of 1 at a time.
- Each call has a 10-second timeout so one stuck RPC node doesn't block the entire refresh.
- A failed wallet silently returns empty signatures (the rest still succeed).
- The `signatureWallets` map-building loop runs after all fetches complete.

**What doesn't change:**

- The `signatureWallets` Map structure and its contents.
- The dedup logic (same signature from multiple wallets still merges into one Set).
- Everything downstream (stale lookup, parsing, DB writes).
- The `signatureLimit` of 100 per wallet.

**Timing impact:**

| Wallets | Before (sequential) | After (concurrency=3) |
| ------- | ------------------- | --------------------- |
| 3       | ~1.2s               | ~0.4s                 |
| 6       | ~2.4s               | ~0.8s                 |
| 10      | ~4.0s               | ~1.3s                 |
| 15      | ~6.0s               | ~2.0s                 |

**Why concurrency=3:** Solana RPC nodes rate-limit at the connection level. 3 concurrent calls avoids 429s on free-tier/shared nodes. Tunable constant — bump to 5 on dedicated RPC plans.

**Why the timeout:** Without it, one hanging RPC call blocks the entire refresh indefinitely. The 10-second cap ensures bounded completion time. The `catch` returning empty is intentional — a single wallet failing shouldn't abort refresh. The next cycle picks it up.

---

## Phase 2: Write-Path Batching + Uniqueness Migration

Medium risk. Requires a data cleanup step before the unique constraint.

### 2a. Uniqueness Constraint on Transaction

**Target:** `@@unique([tokenPublicKey, transactionSignature, walletPublicKey])`

**Pre-step — duplicate detection and cleanup migration:**

Before adding the constraint, run a detection query to find violations:

```sql
SELECT "tokenPublicKey", "transactionSignature", "walletPublicKey", COUNT(*) as cnt
FROM "Transaction"
GROUP BY "tokenPublicKey", "transactionSignature", "walletPublicKey"
HAVING COUNT(*) > 1;
```

If duplicates exist, clean up by keeping the row with the latest `updatedAt`:

```sql
DELETE FROM "Transaction" t1
USING "Transaction" t2
WHERE t1."tokenPublicKey" = t2."tokenPublicKey"
  AND t1."transactionSignature" = t2."transactionSignature"
  AND t1."walletPublicKey" = t2."walletPublicKey"
  AND t1."updatedAt" < t2."updatedAt";
```

Then apply the schema change:

```prisma
model Transaction {
  // ... existing fields and indexes ...

  @@unique([tokenPublicKey, transactionSignature, walletPublicKey])
}
```

**After the constraint is live**, the ingest logic in `refreshByToken` simplifies:

- `createMany({ skipDuplicates: true })` replaces the manual "find existing → diff → insert new" pattern.
- The manual `parsedByKey` / `existingByKey` dedup maps can be removed.
- The DB guarantees no duplicates, so the application doesn't need to.

### 2b. Bulk Write Strategies

**Transaction stale updates** (`transaction.service.ts` lines 597-605):

Replace N individual `prisma.transaction.update` calls inside `$transaction` with a single raw SQL statement:

```typescript
if (updates.length > 0) {
  const values = updates
    .map(
      (u) =>
        `('${u.id}', ${u.data.solAmount}, ${u.data.tokenAmount}, ${u.data.pricePerToken}, ${u.data.feeAmount}, ${u.data.blockTime ? `'${u.data.blockTime.toISOString()}'` : "NULL"})`
    )
    .join(", ");

  await prisma.$executeRawUnsafe(`
    UPDATE "Transaction" AS t SET
      "solAmount" = v.sol::decimal,
      "tokenAmount" = v.token::decimal,
      "pricePerToken" = v.price::decimal,
      "feeAmount" = v.fee::decimal,
      "blockTime" = v.block_time::timestamptz,
      "updatedAt" = NOW()
    FROM (VALUES ${values}) AS v(id, sol, token, price, fee, block_time)
    WHERE t.id = v.id
  `);
}
```

Single statement, single round-trip, regardless of how many rows need updating.

**Holding writes** (`holding.service.ts` lines 314-373):

Replace N individual `create`/`update`/`delete` via `Promise.all` with batched operations:

```typescript
// Collect into three buckets
const toCreate = [];
const toUpdate = [];
const toDelete = [];

for (const { wallet, tokenBalance, ataExists } of balanceResults) {
  // ... same logic, but push into buckets instead of awaiting individually
}

// Execute as three operations instead of N
await Promise.all(
  [
    toCreate.length > 0 ? prisma.holding.createMany({ data: toCreate }) : null,
    toDelete.length > 0
      ? prisma.holding.deleteMany({ where: { id: { in: toDelete } } })
      : null,
    toUpdate.length > 0
      ? prisma.$executeRawUnsafe(/* bulk UPDATE ... FROM VALUES */)
      : null,
  ].filter(Boolean)
);
```

Three DB round-trips maximum instead of N.

---

## Phase 3: Refresh Policy + Token-Level Ingestion

Lower urgency. Tuning, not fixing.

### 3a. Refresh Pressure Reduction

**Increase staleness threshold:**

Change from 60 seconds to 5 minutes (or make full refresh manual-only):

```typescript
// lib/config/cache.config.ts
export const cacheConfig = {
  staleMs: {
    transactions: 300_000, // 5 minutes (was 60_000)
    holdings: 300_000,
    wallets: 300_000,
  },
};
```

With server-side pagination and proper indexes, the `listByToken` query is now instant. The staleness window only controls when the heavier RPC-based refresh fires.

**Per-token concurrency lock:**

Prevent overlapping refreshes from multiple tabs or rapid clicks:

```typescript
const activeRefreshes = new Map<string, Promise<unknown>>();

async function withRefreshLock<T>(
  tokenPublicKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const existing = activeRefreshes.get(tokenPublicKey);
  if (existing) {
    await existing;
    return fn(); // or skip entirely
  }
  const promise = fn();
  activeRefreshes.set(tokenPublicKey, promise);
  try {
    return await promise;
  } finally {
    activeRefreshes.delete(tokenPublicKey);
  }
}
```

**Optional: split light vs full refresh:**

- "Light refresh" = just re-query the DB list (instant with indexes + pagination). Used by auto-stale.
- "Full refresh" = RPC signature fetch + DB writes. Used by manual button only.

### 3b. Token-Level Signature Fetch (Hybrid)

Replace per-wallet `getSignaturesForAddress` with a single call to the bonding curve address:

```typescript
const mint = new PublicKey(token.publicKey);
const { bondingCurve } = derivePumpAddresses(mint);

const signatures = await connection.getSignaturesForAddress(bondingCurve, {
  limit: signatureLimit,
});
```

Then use `parseTransactionForTokenOwners` (already exists in the codebase) to extract per-wallet results from each parsed transaction, and filter to only owned wallets.

This turns N RPC calls into 1. All building blocks exist: `derivePumpAddresses`, `parseTransactionForTokenOwners`. This is a refactor of the refresh path, not new functionality.

**Caveat:** The bonding curve only has transactions while the token is on pump.fun (pre-Raydium migration). Post-migration tokens would need the Raydium pool address as well.

**Recommendation:** Phase 1c (bounded concurrency) already solves most of the wall-clock time. Token-level fetch is a further optimization to consider after the core fixes land.

---

## Expected Impact

| Fix                         | Effort            | Impact                                                             |
| --------------------------- | ----------------- | ------------------------------------------------------------------ |
| 1a. Indexes                 | Migration only    | Queries go from seq scan to index lookup. Biggest single win.      |
| 1b. Server pagination       | ~2 hours          | Page load transfers 10 rows instead of 100+. Wire size drops ~10x. |
| 1c. Bounded RPC concurrency | ~30 min           | Signature fetch wall-clock drops ~3x.                              |
| 2a. Unique constraint       | ~1 hour + cleanup | Simpler ingest logic, DB-enforced safety.                          |
| 2b. Bulk writes             | ~1 hour           | Write time drops proportionally to row count.                      |
| 3a. Refresh tuning          | ~30 min           | Fewer unnecessary full refreshes.                                  |
| 3b. Token-level fetch       | ~1 hour           | 1 RPC call instead of N (further gain after 1c).                   |

Phase 1 alone should resolve the immediate slowdown. Phases 2-3 are hardening and further optimization.
