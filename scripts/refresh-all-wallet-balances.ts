#!/usr/bin/env tsx
/**
 * Refreshes SOL balance for every row in Wallet (chain RPC → DB).
 *
 * Usage:
 *   tsx scripts/refresh-all-wallet-balances.ts [--out path/to/results.json]
 *
 * Requires DATABASE_URL (or PROD_STORAGE_POSTGRES_URL / DEV_STORAGE_POSTGRES_URL)
 * and SOLANA_RPC_URL in the environment (e.g. .env).
 */

import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
import { writeFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { retryRpc } from "../lib/utils/rpc-retry";

dotenv.config({ path: join(process.cwd(), ".env"), quiet: true });
dotenv.config({ path: join(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ path: join(process.cwd(), ".env.development.local"), quiet: true });

const connectionString =
  process.env.DATABASE_URL ||
  process.env.PROD_STORAGE_POSTGRES_URL ||
  process.env.DEV_STORAGE_POSTGRES_URL;

const rpcUrl = process.env.SOLANA_RPC_URL;

if (!connectionString) {
  console.error(
    "Set DATABASE_URL or PROD_STORAGE_POSTGRES_URL / DEV_STORAGE_POSTGRES_URL."
  );
  process.exit(1);
}

if (!rpcUrl) {
  console.error("Set SOLANA_RPC_URL.");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: ["error"],
});

const connection = new Connection(rpcUrl, "confirmed");
const CHUNK = 100;

const args = process.argv.slice(2);
let outFile = join(process.cwd(), "wallet-balance-refresh-results.json");
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--out" || args[i] === "-o") {
    outFile = args[i + 1] ?? outFile;
    i += 1;
  }
}

type Row = {
  publicKey: string;
  type: string;
  balanceSolBefore: string;
  balanceSolAfter: number;
  error?: string;
};

async function main() {
  const startedAt = new Date().toISOString();
  console.log("Loading wallet rows…");
  const wallets = await prisma.wallet.findMany({
    select: { publicKey: true, balanceSol: true, type: true },
    orderBy: { publicKey: "asc" },
  });
  console.log(`Found ${wallets.length} wallet(s). Fetching SOL from RPC…`);

  const now = new Date();
  const rows: Row[] = [];
  let rpcFetched = 0;

  for (let i = 0; i < wallets.length; i += CHUNK) {
    const chunk = wallets.slice(i, i + CHUNK);
    const valid: { w: (typeof wallets)[number]; key: PublicKey }[] = [];

    for (const w of chunk) {
      try {
        valid.push({ w, key: new PublicKey(w.publicKey) });
      } catch {
        rows.push({
          publicKey: w.publicKey,
          type: w.type,
          balanceSolBefore: String(w.balanceSol),
          balanceSolAfter: 0,
          error: "invalid public key",
        });
      }
    }

    if (valid.length === 0) continue;

    const infos = await retryRpc(() =>
      connection.getMultipleAccountsInfo(
        valid.map((v) => v.key),
        "confirmed"
      )
    );

    infos.forEach((info, index) => {
      const item = valid[index];
      if (!item) return;
      const lamports = info ? info.lamports : 0;
      const balanceSol = lamports / LAMPORTS_PER_SOL;
      rows.push({
        publicKey: item.w.publicKey,
        type: item.w.type,
        balanceSolBefore: String(item.w.balanceSol),
        balanceSolAfter: balanceSol,
      });
    });
    rpcFetched += infos.length;
    console.log(`RPC ${rpcFetched}/${wallets.length}`);
  }

  const toPersist = rows.filter((r) => !r.error).length;
  console.log(`Writing ${toPersist} balance(s) to DB…`);

  // One update per row — avoids Prisma's default 5s interactive $transaction timeout
  // when batching many updates against a slow remote DB.
  let dbWritten = 0;
  const logDbEvery = 100;
  for (const r of rows) {
    if (r.error) continue;
    await prisma.wallet.update({
      where: { publicKey: r.publicKey },
      data: {
        balanceSol: r.balanceSolAfter,
        balanceRefreshedAt: now,
      },
    });
    dbWritten += 1;
    if (dbWritten % logDbEvery === 0 || dbWritten === toPersist) {
      console.log(`DB ${dbWritten}/${toPersist}`);
    }
  }

  const completedAt = new Date().toISOString();
  const summary = {
    startedAt,
    completedAt,
    walletCount: wallets.length,
    rowCount: rows.length,
    updatedCount: rows.filter((r) => !r.error).length,
    errorCount: rows.filter((r) => r.error).length,
  };

  const output = { summary, wallets: rows };
  writeFileSync(outFile, JSON.stringify(output, null, 2), "utf8");
  console.log(`Done. Wrote ${outFile}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
