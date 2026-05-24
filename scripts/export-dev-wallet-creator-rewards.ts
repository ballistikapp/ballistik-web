#!/usr/bin/env tsx
/**
 * For every token whose dev wallet is a user wallet (not the platform system wallet),
 * reads the Pump.fun creator vault balance on-chain and writes JSON.
 *
 * Only includes rows where vault rewards (lamports above vault rent) are at least
 * MIN_WORTH_CLAIMING_REWARDS_LAMPORTS — below that, net to main after two 5k base-fee
 * txs is under 0.01 SOL, so we treat them as not worth claiming.
 *
 * DB is only used to list (token → creator dev wallet). Reward amounts come from RPC.
 *
 * Usage:
 *   tsx scripts/export-dev-wallet-creator-rewards.ts [--out path/to/out.json]
 *
 * Requires DATABASE_URL (or PROD_STORAGE_POSTGRES_URL / DEV_STORAGE_POSTGRES_URL)
 * and SOLANA_RPC_URL.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
import { writeFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PUMP_PROGRAM_ID } from "../server/solana/pump/idl";
import { retryRpc } from "../lib/utils/rpc-retry";

dotenv.config({ path: join(process.cwd(), ".env"), quiet: true });
dotenv.config({ path: join(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ path: join(process.cwd(), ".env.development.local"), quiet: true });

const connectionString =
  process.env.DATABASE_URL ||
  process.env.PROD_STORAGE_POSTGRES_URL ||
  process.env.DEV_STORAGE_POSTGRES_URL;

const rpcUrlRaw = process.env.SOLANA_RPC_URL;

if (!connectionString) {
  console.error(
    "Set DATABASE_URL or PROD_STORAGE_POSTGRES_URL / DEV_STORAGE_POSTGRES_URL.",
  );
  process.exit(1);
}

if (!rpcUrlRaw) {
  console.error("Set SOLANA_RPC_URL.");
  process.exit(1);
}

const rpcUrl: string = rpcUrlRaw;

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: ["error"],
});

const RENT_EXEMPT_LAMPORTS = BigInt(890_880);
/** 0.01 SOL net to main + 2 × 5_000 lamport base fees (collect + payout). */
const MIN_WORTH_CLAIMING_REWARDS_LAMPORTS = BigInt(10_010_000);
const CHUNK = 50;

const args = process.argv.slice(2);
let outFile = join(process.cwd(), "dev-wallet-creator-rewards.json");
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--out" || args[i] === "-o") {
    outFile = args[i + 1] ?? outFile;
    i += 1;
  }
}

function deriveCreatorVault(creatorPubkey: PublicKey): PublicKey {
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creatorPubkey.toBuffer()],
    PUMP_PROGRAM_ID,
  );
  return vault;
}

function replacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  return value;
}

type VaultFetch = {
  creatorWalletPublicKey: string;
  creatorVaultPublicKey: string;
  vaultLamportsRaw: string;
  vaultRewardsLamports: string;
  error?: string;
};

async function main() {
  const links = await prisma.tokenDevWallet.findMany({
    where: { wallet: { isSystemWallet: false } },
    select: {
      tokenPublicKey: true,
      wallet: { select: { publicKey: true } },
    },
    orderBy: { tokenPublicKey: "asc" },
  });

  const uniqueCreators = [...new Set(links.map((l) => l.wallet.publicKey))];
  const connection = new Connection(rpcUrl, "confirmed");

  const vaultByCreator = new Map<string, VaultFetch>();

  for (let i = 0; i < uniqueCreators.length; i += CHUNK) {
    const batch = uniqueCreators.slice(i, i + CHUNK);
    await Promise.all(
      batch.map(async (pk) => {
        const creator = new PublicKey(pk);
        const vault = deriveCreatorVault(creator);
        try {
          const raw = BigInt(
            await retryRpc(() =>
              connection.getBalance(vault, "confirmed"),
            ),
          );
          const rewards =
            raw > RENT_EXEMPT_LAMPORTS ? raw - RENT_EXEMPT_LAMPORTS : BigInt(0);
          vaultByCreator.set(pk, {
            creatorWalletPublicKey: pk,
            creatorVaultPublicKey: vault.toBase58(),
            vaultLamportsRaw: raw.toString(),
            vaultRewardsLamports: rewards.toString(),
          });
        } catch (err) {
          vaultByCreator.set(pk, {
            creatorWalletPublicKey: pk,
            creatorVaultPublicKey: vault.toBase58(),
            vaultLamportsRaw: "0",
            vaultRewardsLamports: "0",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  const allTokens = links.map((row) => {
    const chain = vaultByCreator.get(row.wallet.publicKey)!;
    return {
      tokenPublicKey: row.tokenPublicKey,
      creatorWalletPublicKey: row.wallet.publicKey,
      creatorVaultPublicKey: chain.creatorVaultPublicKey,
      vaultLamportsRaw: chain.vaultLamportsRaw,
      vaultRewardsLamports: chain.vaultRewardsLamports,
      ...(chain.error ? { rpcError: chain.error } : {}),
    };
  });

  const tokens = allTokens.filter(
    (row) => BigInt(row.vaultRewardsLamports) >= MIN_WORTH_CLAIMING_REWARDS_LAMPORTS,
  );

  const includedCreators = new Set(tokens.map((t) => t.creatorWalletPublicKey));

  let rpcHost: string;
  try {
    rpcHost = new URL(rpcUrl).hostname;
  } catch {
    rpcHost = "(invalid SOLANA_RPC_URL)";
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    rpcHost,
    summary: {
      minVaultRewardsLamportsThreshold:
        MIN_WORTH_CLAIMING_REWARDS_LAMPORTS.toString(),
      tokenRowsScanned: allTokens.length,
      tokenRowsIncluded: tokens.length,
      uniqueCreatorWalletsScanned: uniqueCreators.length,
      uniqueCreatorWalletsIncluded: includedCreators.size,
    },
    tokens,
  };

  writeFileSync(outFile, JSON.stringify(payload, replacer, 2), "utf8");
  console.log(
    `Wrote ${tokens.length}/${allTokens.length} token row(s) (≥ ${MIN_WORTH_CLAIMING_REWARDS_LAMPORTS} vault reward lamports), ${includedCreators.size} creator wallet(s) → ${outFile}`,
  );
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
