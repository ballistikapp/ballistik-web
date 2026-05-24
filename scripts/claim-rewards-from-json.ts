#!/usr/bin/env tsx
/**
 * Claims Pump creator vault SOL for each unique dev wallet listed in rewards.json,
 * then pays out to the funder wallet (public key derived from FUNDER_WALLET_PRIVATE_KEY).
 *
 * - Groups `tokens` by `creatorWalletPublicKey` (one vault per creator; shared across mints).
 * - Loads dev wallet private keys from the DB (must not be system wallet).
 * - Funds the dev wallet from the funder when balance is below the same overhead as
 *   server/services/creator-rewards.service.ts (DEV_WALLET_OVERHEAD_LAMPORTS).
 * - On any failure after funding, sweeps dev → funder to recover the funding.
 *
 * Usage:
 *   tsx scripts/claim-rewards-from-json.ts [--input ./rewards.json] [--out ./claim-rewards-results.json]
 *
 * Env: DATABASE_URL (or PROD_STORAGE_POSTGRES_URL / DEV_STORAGE_POSTGRES_URL), SOLANA_RPC_URL,
 *      FUNDER_WALLET_PRIVATE_KEY (bs58).
 *
 * Does not update CreatorRewardBalance / app transactions in the DB — on-chain only.
 */

import * as dotenv from "dotenv";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type Connection as SolanaConnection,
} from "@solana/web3.js";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PUMP_PROGRAM_ID } from "../server/solana/pump/idl";
import { retryRpc } from "../lib/utils/rpc-retry";

dotenv.config({ path: join(process.cwd(), ".env"), quiet: true });
dotenv.config({ path: join(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ path: join(process.cwd(), ".env.development.local"), quiet: true });

const TX_FEE_LAMPORTS = BigInt(5000);
const RENT_EXEMPT_LAMPORTS = BigInt(890_880);
const DEV_WALLET_OVERHEAD_LAMPORTS = BigInt(1_000_000);
const MIN_CLAIMABLE_VAULT_LAMPORTS = BigInt(100_000);
const COLLECT_CREATOR_FEE_DISCRIMINATOR = Buffer.from([
  20, 22, 86, 123, 198, 28, 219, 132,
]);
const BIGINT_ZERO = BigInt(0);

const connectionString =
  process.env.DATABASE_URL ||
  process.env.PROD_STORAGE_POSTGRES_URL ||
  process.env.DEV_STORAGE_POSTGRES_URL;

const rpcUrlRaw = process.env.SOLANA_RPC_URL;
const funderSecretRaw = process.env.FUNDER_WALLET_PRIVATE_KEY?.trim();

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

if (!funderSecretRaw) {
  console.error("Set FUNDER_WALLET_PRIVATE_KEY.");
  process.exit(1);
}

const rpcUrl = rpcUrlRaw;
const funderSecret = funderSecretRaw;

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: ["error"],
});

type RewardsJson = {
  tokens?: Array<{
    tokenPublicKey: string;
    creatorWalletPublicKey: string;
  }>;
};

type CreatorResult = {
  creatorWalletPublicKey: string;
  tokenPublicKeys: string[];
  status: "success" | "skipped" | "error";
  vaultRewardsLamportsBefore?: string;
  fundedLamports?: string;
  fundSignature?: string | null;
  claimSignature?: string | null;
  claimedLamports?: string;
  payoutSignature?: string | null;
  payoutLamports?: string;
  /** Dust sweep after main payout (optional). */
  extraSweepSignature?: string | null;
  extraSweepLamports?: string;
  sweepAfterErrorSignature?: string | null;
  sweepAfterErrorLamports?: string;
  error?: string;
};

function deriveCreatorVault(creatorPubkey: PublicKey): PublicKey {
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creatorPubkey.toBuffer()],
    PUMP_PROGRAM_ID,
  );
  return vault;
}

function buildCollectCreatorFeeInstruction(creatorKeypair: Keypair): TransactionInstruction {
  const creatorVault = deriveCreatorVault(creatorKeypair.publicKey);
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM_ID,
  );

  return new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: creatorKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: COLLECT_CREATOR_FEE_DISCRIMINATOR,
  });
}

async function getCreatorVaultRewardsLamports(
  connection: SolanaConnection,
  creatorPubkey: PublicKey,
): Promise<{ raw: bigint; rewards: bigint }> {
  const vault = deriveCreatorVault(creatorPubkey);
  const raw = BigInt(
    await retryRpc(() => connection.getBalance(vault, "confirmed")),
  );
  const rewards =
    raw > RENT_EXEMPT_LAMPORTS ? raw - RENT_EXEMPT_LAMPORTS : BIGINT_ZERO;
  return { raw, rewards };
}

async function fundDevFromFunder(
  connection: SolanaConnection,
  funderKeypair: Keypair,
  devPubkey: PublicKey,
  amountLamports: bigint,
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funderKeypair.publicKey,
      toPubkey: devPubkey,
      lamports: amountLamports,
    }),
  );
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = funderKeypair.publicKey;

  return sendAndConfirmTransaction(connection, tx, [funderKeypair], {
    commitment: "confirmed",
  });
}

async function ensureDevWalletFunded(
  connection: SolanaConnection,
  devKeypair: Keypair,
  funderKeypair: Keypair,
  requiredLamports: bigint,
): Promise<{ fundedLamports: bigint; fundSignature: string | null }> {
  const devBalance = BigInt(
    await retryRpc(() =>
      connection.getBalance(devKeypair.publicKey, "confirmed"),
    ),
  );

  const minBalance =
    requiredLamports > RENT_EXEMPT_LAMPORTS
      ? requiredLamports
      : RENT_EXEMPT_LAMPORTS;
  if (devBalance >= minBalance) {
    return { fundedLamports: BIGINT_ZERO, fundSignature: null };
  }

  const fundingNeeded = minBalance - devBalance;
  const mainBalance = BigInt(
    await retryRpc(() =>
      connection.getBalance(funderKeypair.publicKey, "confirmed"),
    ),
  );

  const mainNeeds = fundingNeeded + TX_FEE_LAMPORTS;
  if (mainBalance < mainNeeds) {
    throw new Error(
      `Funder has insufficient SOL: need ${mainNeeds.toString()} lamports, have ${mainBalance.toString()}`,
    );
  }

  const sig = await fundDevFromFunder(
    connection,
    funderKeypair,
    devKeypair.publicKey,
    fundingNeeded,
  );
  return { fundedLamports: fundingNeeded, fundSignature: sig };
}

async function claimFromPump(
  connection: SolanaConnection,
  creatorKeypair: Keypair,
): Promise<{ signature: string; claimedLamports: bigint }> {
  const preLamports = BigInt(
    await retryRpc(() =>
      connection.getBalance(creatorKeypair.publicKey, "confirmed"),
    ),
  );

  const ix = buildCollectCreatorFeeInstruction(creatorKeypair);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = creatorKeypair.publicKey;

  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [creatorKeypair],
    { commitment: "confirmed" },
  );

  const postLamports = BigInt(
    await retryRpc(() =>
      connection.getBalance(creatorKeypair.publicKey, "confirmed"),
    ),
  );

  const claimedLamports = postLamports - preLamports;

  return {
    signature,
    claimedLamports: claimedLamports > BIGINT_ZERO ? claimedLamports : BIGINT_ZERO,
  };
}

async function payoutToFunder(
  connection: SolanaConnection,
  devKeypair: Keypair,
  funderPubkey: PublicKey,
  payoutLamports: bigint,
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: devKeypair.publicKey,
      toPubkey: funderPubkey,
      lamports: payoutLamports,
    }),
  );
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = devKeypair.publicKey;

  return sendAndConfirmTransaction(connection, tx, [devKeypair], {
    commitment: "confirmed",
  });
}

/** Sends everything possible from dev to funder while keeping rent + one fee on dev. */
async function sweepDevToFunder(
  connection: SolanaConnection,
  devKeypair: Keypair,
  funderPubkey: PublicKey,
): Promise<{ signature: string | null; lamports: bigint }> {
  const devBalance = BigInt(
    await retryRpc(() =>
      connection.getBalance(devKeypair.publicKey, "confirmed"),
    ),
  );
  const maxPayable =
    devBalance - RENT_EXEMPT_LAMPORTS - TX_FEE_LAMPORTS;
  if (maxPayable <= BIGINT_ZERO) {
    return { signature: null, lamports: BIGINT_ZERO };
  }
  const sig = await payoutToFunder(
    connection,
    devKeypair,
    funderPubkey,
    maxPayable,
  );
  return { signature: sig, lamports: maxPayable };
}

function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  let inputFile = join(process.cwd(), "rewards.json");
  let outFile = join(process.cwd(), "claim-rewards-results.json");
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--input" || args[i] === "-i") {
      const p = args[i + 1];
      if (p) inputFile = join(process.cwd(), p);
      i += 1;
    } else if (args[i] === "--out" || args[i] === "-o") {
      const p = args[i + 1];
      if (p) outFile = join(process.cwd(), p);
      i += 1;
    }
  }

  const raw = readFileSync(inputFile, "utf8");
  const data = JSON.parse(raw) as RewardsJson;
  const rows = data.tokens ?? [];
  if (rows.length === 0) {
    console.error("No tokens in input file.");
    process.exit(1);
  }

  const funderKeypair = Keypair.fromSecretKey(bs58.decode(funderSecret));
  const funderPubkey = funderKeypair.publicKey;

  const byCreator = new Map<string, string[]>();
  for (const row of rows) {
    const pk = row.creatorWalletPublicKey;
    const mint = row.tokenPublicKey;
    const list = byCreator.get(pk) ?? [];
    if (!list.includes(mint)) list.push(mint);
    byCreator.set(pk, list);
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const startedAt = new Date().toISOString();
  const results: CreatorResult[] = [];

  const sortedCreators = [...byCreator.keys()].sort();

  for (const creatorWalletPublicKey of sortedCreators) {
    const tokenPublicKeys = byCreator.get(creatorWalletPublicKey)!;
    const base: CreatorResult = {
      creatorWalletPublicKey,
      tokenPublicKeys,
      status: "error",
    };

    const walletRow = await prisma.wallet.findUnique({
      where: { publicKey: creatorWalletPublicKey },
      select: { privateKey: true, isSystemWallet: true },
    });

    if (!walletRow?.privateKey) {
      results.push({
        ...base,
        status: "error",
        error: "Wallet not found in DB or missing private key",
      });
      continue;
    }

    if (walletRow.isSystemWallet) {
      results.push({
        ...base,
        status: "skipped",
        error: "System dev wallet — cannot claim via this script",
      });
      continue;
    }

    let devKeypair: Keypair;
    try {
      devKeypair = Keypair.fromSecretKey(bs58.decode(walletRow.privateKey));
    } catch {
      results.push({
        ...base,
        status: "error",
        error: "Failed to decode dev wallet private key",
      });
      continue;
    }

    if (devKeypair.publicKey.toBase58() !== creatorWalletPublicKey) {
      results.push({
        ...base,
        status: "error",
        error: "DB private key does not match creatorWalletPublicKey",
      });
      continue;
    }

    const vaultBefore = await getCreatorVaultRewardsLamports(
      connection,
      devKeypair.publicKey,
    );
    base.vaultRewardsLamportsBefore = vaultBefore.rewards.toString();

    if (vaultBefore.rewards <= BIGINT_ZERO) {
      results.push({
        ...base,
        status: "skipped",
        error: "Creator vault has no reward lamports above rent",
      });
      continue;
    }

    if (vaultBefore.rewards < MIN_CLAIMABLE_VAULT_LAMPORTS) {
      results.push({
        ...base,
        status: "skipped",
        error: `Vault rewards below MIN_CLAIMABLE_VAULT_LAMPORTS (${MIN_CLAIMABLE_VAULT_LAMPORTS.toString()})`,
      });
      continue;
    }

    let fundedLamports = BIGINT_ZERO;
    let fundSignature: string | null = null;

    try {
      const fund = await ensureDevWalletFunded(
        connection,
        devKeypair,
        funderKeypair,
        DEV_WALLET_OVERHEAD_LAMPORTS,
      );
      fundedLamports = fund.fundedLamports;
      fundSignature = fund.fundSignature;

      const { signature: claimSig, claimedLamports } = await claimFromPump(
        connection,
        devKeypair,
      );

      if (claimedLamports <= BIGINT_ZERO) {
        const sweep = await sweepDevToFunder(
          connection,
          devKeypair,
          funderPubkey,
        );
        results.push({
          ...base,
          status: "error",
          fundedLamports: fundedLamports.toString(),
          fundSignature,
          claimSignature: claimSig,
          claimedLamports: claimedLamports.toString(),
          sweepAfterErrorSignature: sweep.signature,
          sweepAfterErrorLamports: sweep.lamports.toString(),
          error:
            "Collect returned no net lamports to dev — swept dev back to funder if any",
        });
        continue;
      }

      const devBalanceAfterClaim = BigInt(
        await retryRpc(() =>
          connection.getBalance(devKeypair.publicKey, "confirmed"),
        ),
      );
      const maxPayable =
        devBalanceAfterClaim - RENT_EXEMPT_LAMPORTS - TX_FEE_LAMPORTS;

      if (maxPayable <= BIGINT_ZERO) {
        const sweep = await sweepDevToFunder(
          connection,
          devKeypair,
          funderPubkey,
        );
        results.push({
          ...base,
          status: "error",
          fundedLamports: fundedLamports.toString(),
          fundSignature,
          claimSignature: claimSig,
          claimedLamports: claimedLamports.toString(),
          sweepAfterErrorSignature: sweep.signature,
          sweepAfterErrorLamports: sweep.lamports.toString(),
          error: "Nothing payable to funder after claim (fees/rent) — swept if possible",
        });
        continue;
      }

      const payoutSig = await payoutToFunder(
        connection,
        devKeypair,
        funderPubkey,
        maxPayable,
      );

      const secondSweep = await sweepDevToFunder(
        connection,
        devKeypair,
        funderPubkey,
      );

      results.push({
        ...base,
        status: "success",
        fundedLamports: fundedLamports.toString(),
        fundSignature,
        claimSignature: claimSig,
        claimedLamports: claimedLamports.toString(),
        payoutSignature: payoutSig,
        payoutLamports: maxPayable.toString(),
        ...(secondSweep.lamports > BIGINT_ZERO
          ? {
              extraSweepSignature: secondSweep.signature,
              extraSweepLamports: secondSweep.lamports.toString(),
            }
          : {}),
      });
    } catch (err) {
      let sweepSig: string | null = null;
      let sweepLamports = BIGINT_ZERO;
      try {
        const sweep = await sweepDevToFunder(
          connection,
          devKeypair,
          funderPubkey,
        );
        sweepSig = sweep.signature;
        sweepLamports = sweep.lamports;
      } catch {
        /* ignore */
      }

      results.push({
        ...base,
        status: "error",
        fundedLamports: fundedLamports.toString(),
        fundSignature,
        error: err instanceof Error ? err.message : String(err),
        sweepAfterErrorSignature: sweepSig,
        sweepAfterErrorLamports: sweepLamports.toString(),
      });
    }
  }

  const completedAt = new Date().toISOString();
  const success = results.filter((r) => r.status === "success").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "error").length;

  const payload = {
    startedAt,
    completedAt,
    inputFile,
    funderPublicKey: funderPubkey.toBase58(),
    rpcUrlHost: (() => {
      try {
        return new URL(rpcUrl).hostname;
      } catch {
        return "";
      }
    })(),
    summary: {
      creatorGroups: results.length,
      success,
      skipped,
      failed,
    },
    results,
  };

  writeFileSync(
    outFile,
    JSON.stringify(payload, jsonReplacer, 2),
    "utf8",
  );
  console.log(
    `Done. ${success} ok, ${skipped} skipped, ${failed} failed. Wrote ${outFile}`,
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
