import "server-only";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { AppError } from "@/server/errors";
import { getEnv } from "@/lib/config/env";
import { getSolanaConnection } from "@/lib/solana/connection";
import { retryRpc } from "@/lib/utils/rpc-retry";
import { appTransactionService } from "@/server/services/app-transaction.service";
import { settleSignature } from "@/server/services/app-transaction-settler";
import { invalidateStatsCache } from "@/server/services/dashboard.service";
import { derivePumpAddresses, DISCRIMINATORS } from "@/server/solana/pump-new-idl";
import { PUMP_PROGRAM_ID } from "@/server/solana/pump-idl";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type Connection,
} from "@solana/web3.js";
import bs58 from "bs58";

const log = logger.child({ service: "creator-rewards" });

const TX_FEE_LAMPORTS = BigInt(5000);
const RENT_EXEMPT_LAMPORTS = BigInt(890_880);
const DEV_WALLET_OVERHEAD_LAMPORTS = BigInt(1_000_000);
const MIN_CLAIMABLE_VAULT_LAMPORTS = BigInt(100_000);
const COLLECT_CREATOR_FEE_DISCRIMINATOR = Buffer.from([20, 22, 86, 123, 198, 28, 219, 132]);
const SIGNATURE_FETCH_LIMIT = 200;
const TX_FETCH_CONCURRENCY = 5;
const BIGINT_ZERO = BigInt(0);

const claimLocks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = claimLocks.get(key) ?? Promise.resolve();
  const settled = existing.catch(() => {});
  const chained = settled.then(fn);
  const cleanup = chained.catch(() => {}).finally(() => {
    if (claimLocks.get(key) === cleanup) {
      claimLocks.delete(key);
    }
  });
  claimLocks.set(key, cleanup);
  return chained;
}

type ResolvedCreatorWallet = {
  publicKey: string;
  isSystemWallet: boolean;
  keypair: Keypair;
};

async function resolveCreatorWallet(
  tokenPublicKey: string,
  userId: string
): Promise<ResolvedCreatorWallet> {
  const devWallet = await prisma.tokenDevWallet.findFirst({
    where: { tokenPublicKey },
    select: {
      wallet: {
        select: { publicKey: true, privateKey: true, isSystemWallet: true },
      },
    },
  });

  if (!devWallet?.wallet) {
    throw new AppError("No creator wallet found for this token", 404);
  }

  const { wallet } = devWallet;

  if (wallet.isSystemWallet) {
    const { SYSTEM_DEV_WALLET_PRIVATE_KEY } = getEnv();
    return {
      publicKey: wallet.publicKey,
      isSystemWallet: true,
      keypair: Keypair.fromSecretKey(bs58.decode(SYSTEM_DEV_WALLET_PRIVATE_KEY)),
    };
  }

  if (!wallet.privateKey) {
    throw new AppError("Dev wallet private key is not available — cannot claim rewards", 400);
  }

  return {
    publicKey: wallet.publicKey,
    isSystemWallet: false,
    keypair: Keypair.fromSecretKey(bs58.decode(wallet.privateKey)),
  };
}

async function ensureTokenOwnership(tokenPublicKey: string, userId: string) {
  const token = await prisma.token.findFirst({
    where: { publicKey: tokenPublicKey, userId },
    select: { publicKey: true },
  });
  if (!token) {
    throw new AppError("Token not found", 404);
  }
}

async function getOrCreateBalance(tokenPublicKey: string, userId: string, creatorWallet: ResolvedCreatorWallet) {
  let balance = await prisma.creatorRewardBalance.findUnique({
    where: { userId_tokenPublicKey: { userId, tokenPublicKey } },
  });

  if (!balance) {
    balance = await prisma.creatorRewardBalance.create({
      data: {
        userId,
        tokenPublicKey,
        creatorWalletPublicKey: creatorWallet.publicKey,
        isSystemWallet: creatorWallet.isSystemWallet,
      },
    });
  }

  return balance;
}

function deriveCreatorVault(creatorPubkey: PublicKey): PublicKey {
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creatorPubkey.toBuffer()],
    PUMP_PROGRAM_ID,
  );
  return vault;
}

async function fetchRewardSignatures(
  connection: Connection,
  tokenPublicKey: string,
  afterSignature: string | null,
): Promise<string[]> {
  const mint = new PublicKey(tokenPublicKey);
  const { bondingCurve } = derivePumpAddresses(mint);

  const options: { limit: number; until?: string } = { limit: SIGNATURE_FETCH_LIMIT };
  if (afterSignature) {
    options.until = afterSignature;
  }

  const sigInfos = await retryRpc(() =>
    connection.getSignaturesForAddress(bondingCurve, options),
  );

  return sigInfos
    .filter((info) => !info.err)
    .map((info) => info.signature);
}

function getAllAccountKeys(
  tx: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>,
): PublicKey[] {
  const staticKeys = tx.transaction.message.staticAccountKeys;
  const loaded = tx.meta?.loadedAddresses;
  if (!loaded) return staticKeys;
  return [
    ...staticKeys,
    ...loaded.writable.map((addr) => new PublicKey(addr)),
    ...loaded.readonly.map((addr) => new PublicKey(addr)),
  ];
}

function extractCreatorFeeDelta(
  tx: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>,
  creatorVaultPubkey: PublicKey,
): bigint {
  const allKeys = getAllAccountKeys(tx);
  const vaultStr = creatorVaultPubkey.toBase58();
  const vaultIndex = allKeys.findIndex((k) => k.toBase58() === vaultStr);

  if (vaultIndex < 0) return BIGINT_ZERO;

  const pre = BigInt(tx.meta?.preBalances[vaultIndex] ?? 0);
  const post = BigInt(tx.meta?.postBalances[vaultIndex] ?? 0);
  const delta = post - pre;

  return delta > BIGINT_ZERO ? delta : BIGINT_ZERO;
}

function extractTradeSide(
  tx: NonNullable<Awaited<ReturnType<Connection["getTransaction"]>>>,
): string {
  const instructions = tx.transaction.message.compiledInstructions;
  const allKeys = getAllAccountKeys(tx);

  for (const ix of instructions) {
    const programId = allKeys[ix.programIdIndex];
    if (!programId || programId.toBase58() !== PUMP_PROGRAM_ID.toBase58()) continue;

    const data = Buffer.from(ix.data);
    if (data.length < 8) continue;

    const disc = data.subarray(0, 8);
    if (disc.equals(DISCRIMINATORS.BUY) || disc.equals(DISCRIMINATORS.BUY_EXACT_SOL_IN)) {
      return "BUY";
    }
    if (disc.equals(DISCRIMINATORS.SELL)) {
      return "SELL";
    }
  }

  return "UNKNOWN";
}

async function reconcileTokenRewards(
  tokenPublicKey: string,
  userId: string,
  creatorWallet: ResolvedCreatorWallet,
) {
  const connection = getSolanaConnection();
  const creatorVault = deriveCreatorVault(new PublicKey(creatorWallet.publicKey));

  const existingBalance = await prisma.creatorRewardBalance.findUnique({
    where: { userId_tokenPublicKey: { userId, tokenPublicKey } },
    select: { lastAccrualSignature: true },
  });

  const newSignatures = await fetchRewardSignatures(
    connection,
    tokenPublicKey,
    existingBalance?.lastAccrualSignature ?? null,
  );

  if (newSignatures.length === 0) {
    await prisma.creatorRewardBalance.update({
      where: { userId_tokenPublicKey: { userId, tokenPublicKey } },
      data: { lastReconciledAt: new Date() },
    });
    return;
  }

  const existingAccruals = await prisma.creatorRewardAccrual.findMany({
    where: {
      tokenPublicKey,
      transactionSignature: { in: newSignatures },
    },
    select: { transactionSignature: true, tradeSide: true },
  });

  const existingSet = new Set(
    existingAccruals.map((a) => `${a.transactionSignature}:${a.tradeSide}`),
  );

  const toProcess = newSignatures.filter(
    (sig) => !existingSet.has(`${sig}:BUY`) && !existingSet.has(`${sig}:SELL`),
  );

  let totalNewAccrual = BIGINT_ZERO;
  let latestSignature: string | null = null;
  let latestSlot: bigint | null = null;

  for (let i = 0; i < toProcess.length; i += TX_FETCH_CONCURRENCY) {
    const batch = toProcess.slice(i, i + TX_FETCH_CONCURRENCY);

    const txResults = await Promise.all(
      batch.map((sig) =>
        retryRpc(() =>
          connection.getTransaction(sig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          }),
        ),
      ),
    );

    for (let j = 0; j < batch.length; j++) {
      const sig = batch[j];
      const tx = txResults[j];
      if (!tx?.meta) continue;

      const feeDelta = extractCreatorFeeDelta(tx, creatorVault);
      if (feeDelta <= BIGINT_ZERO) continue;

      const tradeSide = extractTradeSide(tx);
      if (tradeSide === "UNKNOWN") continue;

      const dedupeKey = `${sig}:${tradeSide}`;
      if (existingSet.has(dedupeKey)) continue;
      existingSet.add(dedupeKey);

      try {
        await prisma.creatorRewardAccrual.create({
          data: {
            tokenPublicKey,
            creatorWalletPublicKey: creatorWallet.publicKey,
            transactionSignature: sig,
            slot: BigInt(tx.slot),
            blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
            tradeSide,
            creatorFeeLamports: feeDelta,
          },
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("Unique constraint")) {
          continue;
        }
        throw err;
      }

      totalNewAccrual += feeDelta;

      if (latestSlot === null || BigInt(tx.slot) > latestSlot) {
        latestSlot = BigInt(tx.slot);
        latestSignature = sig;
      }
    }
  }

  const totalAccrued = await prisma.creatorRewardAccrual.aggregate({
    where: { tokenPublicKey, creatorWalletPublicKey: creatorWallet.publicKey },
    _sum: { creatorFeeLamports: true },
  });

  const accruedLamports = totalAccrued._sum.creatorFeeLamports ?? BIGINT_ZERO;

  await prisma.creatorRewardBalance.update({
    where: { userId_tokenPublicKey: { userId, tokenPublicKey } },
    data: {
      accruedLamports,
      ...(latestSignature ? { lastAccrualSignature: latestSignature } : {}),
      ...(latestSlot !== null ? { lastAccrualSlot: latestSlot } : {}),
      lastReconciledAt: new Date(),
    },
  });

  log.info("Reward reconciliation complete", {
    tokenPublicKey,
    newSignaturesScanned: newSignatures.length,
    newAccruals: toProcess.length,
    totalNewAccrualLamports: totalNewAccrual.toString(),
    totalAccruedLamports: accruedLamports.toString(),
  });
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

async function getCreatorVaultBalance(
  connection: Connection,
  creatorPubkey: PublicKey,
): Promise<bigint> {
  const vault = deriveCreatorVault(creatorPubkey);
  return BigInt(
    await retryRpc(() => connection.getBalance(vault, "confirmed")),
  );
}

async function fundDevWallet(
  connection: Connection,
  mainKeypair: Keypair,
  devPubkey: PublicKey,
  amountLamports: bigint,
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: mainKeypair.publicKey,
      toPubkey: devPubkey,
      lamports: amountLamports,
    }),
  );
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = mainKeypair.publicKey;

  return sendAndConfirmTransaction(connection, tx, [mainKeypair], {
    commitment: "confirmed",
  });
}

async function claimFromPump(
  connection: Connection,
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

async function payoutToMainWallet(
  connection: Connection,
  creatorKeypair: Keypair,
  mainWalletPublicKey: PublicKey,
  payoutLamports: bigint,
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: creatorKeypair.publicKey,
      toPubkey: mainWalletPublicKey,
      lamports: payoutLamports,
    }),
  );
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = creatorKeypair.publicKey;

  return sendAndConfirmTransaction(connection, tx, [creatorKeypair], {
    commitment: "confirmed",
  });
}

function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / 1e9;
}

async function ensureDevWalletFunded(
  connection: Connection,
  creatorWallet: ResolvedCreatorWallet,
  mainKeypair: Keypair,
  requiredLamports: bigint,
): Promise<void> {
  if (creatorWallet.isSystemWallet) return;

  const devBalance = BigInt(
    await retryRpc(() =>
      connection.getBalance(creatorWallet.keypair.publicKey, "confirmed"),
    ),
  );

  const minBalance = requiredLamports > RENT_EXEMPT_LAMPORTS ? requiredLamports : RENT_EXEMPT_LAMPORTS;
  if (devBalance >= minBalance) return;

  const fundingNeeded = minBalance - devBalance;
  const mainBalance = BigInt(
    await retryRpc(() =>
      connection.getBalance(mainKeypair.publicKey, "confirmed"),
    ),
  );

  const mainNeeds = fundingNeeded + TX_FEE_LAMPORTS;
  if (mainBalance < mainNeeds) {
    if (devBalance <= BIGINT_ZERO && mainBalance < TX_FEE_LAMPORTS) {
      throw new AppError(
        "Both your dev wallet and main wallet have insufficient SOL to process this claim",
        400,
      );
    }
    throw new AppError(
      "Main wallet has insufficient SOL to fund the dev wallet for this claim",
      400,
    );
  }

  log.info("Funding dev wallet for reward claim", {
    devWallet: creatorWallet.publicKey,
    devBalance: devBalance.toString(),
    fundingNeeded: fundingNeeded.toString(),
  });

  await fundDevWallet(
    connection,
    mainKeypair,
    creatorWallet.keypair.publicKey,
    fundingNeeded,
  );
}

async function computeEffectiveClaimable(
  ledgerClaimable: bigint,
  creatorWalletPublicKey: string,
): Promise<bigint> {
  if (ledgerClaimable <= BIGINT_ZERO) return BIGINT_ZERO;

  const connection = getSolanaConnection();
  const rawVaultBalance = await getCreatorVaultBalance(
    connection,
    new PublicKey(creatorWalletPublicKey),
  );
  const vaultRewards = rawVaultBalance > RENT_EXEMPT_LAMPORTS
    ? rawVaultBalance - RENT_EXEMPT_LAMPORTS
    : BIGINT_ZERO;

  const effective = ledgerClaimable < vaultRewards ? ledgerClaimable : vaultRewards;

  log.info("Effective claimable computed", {
    creatorWalletPublicKey,
    ledgerClaimable: ledgerClaimable.toString(),
    rawVaultBalance: rawVaultBalance.toString(),
    vaultRewards: vaultRewards.toString(),
    effective: effective.toString(),
  });

  return effective;
}

function ineligibleResponse(tokenPublicKey: string, creatorWalletPublicKey: string) {
  return {
    tokenPublicKey,
    creatorWalletPublicKey,
    isSystemWallet: true,
    eligible: false as const,
    accruedLamports: "0",
    paidOutLamports: "0",
    claimableLamports: "0",
    claimableSol: 0,
    accruedSol: 0,
    paidOutSol: 0,
    lastReconciledAt: null,
  };
}

export const creatorRewardsService = {
  async getByToken(tokenPublicKey: string, userId: string) {
    await ensureTokenOwnership(tokenPublicKey, userId);
    const creatorWallet = await resolveCreatorWallet(tokenPublicKey, userId);

    if (creatorWallet.isSystemWallet) {
      return ineligibleResponse(tokenPublicKey, creatorWallet.publicKey);
    }

    const balance = await getOrCreateBalance(tokenPublicKey, userId, creatorWallet);

    const ledgerClaimable = balance.accruedLamports - balance.paidOutLamports;
    const claimableLamports = await computeEffectiveClaimable(
      ledgerClaimable,
      creatorWallet.publicKey,
    );

    return {
      tokenPublicKey,
      creatorWalletPublicKey: creatorWallet.publicKey,
      isSystemWallet: creatorWallet.isSystemWallet,
      eligible: true as const,
      accruedLamports: balance.accruedLamports.toString(),
      paidOutLamports: balance.paidOutLamports.toString(),
      claimableLamports: claimableLamports.toString(),
      claimableSol: lamportsToSol(claimableLamports),
      accruedSol: lamportsToSol(balance.accruedLamports),
      paidOutSol: lamportsToSol(balance.paidOutLamports),
      lastReconciledAt: balance.lastReconciledAt,
    };
  },

  async refreshByToken(tokenPublicKey: string, userId: string) {
    await ensureTokenOwnership(tokenPublicKey, userId);
    const creatorWallet = await resolveCreatorWallet(tokenPublicKey, userId);

    if (creatorWallet.isSystemWallet) {
      return ineligibleResponse(tokenPublicKey, creatorWallet.publicKey);
    }

    await getOrCreateBalance(tokenPublicKey, userId, creatorWallet);

    await reconcileTokenRewards(tokenPublicKey, userId, creatorWallet);

    return this.getByToken(tokenPublicKey, userId);
  },

  async claimByToken(tokenPublicKey: string, userId: string) {
    await ensureTokenOwnership(tokenPublicKey, userId);
    const creatorWallet = await resolveCreatorWallet(tokenPublicKey, userId);

    if (creatorWallet.isSystemWallet) {
      throw new AppError("Creator rewards are not available for tokens using the system dev wallet", 400);
    }

    const lockKey = `${creatorWallet.publicKey}:${tokenPublicKey}`;

    return withLock(lockKey, async () => {
      await getOrCreateBalance(tokenPublicKey, userId, creatorWallet);
      await reconcileTokenRewards(tokenPublicKey, userId, creatorWallet);

      const balance = await prisma.creatorRewardBalance.findUnique({
        where: { userId_tokenPublicKey: { userId, tokenPublicKey } },
      });
      if (!balance) {
        throw new AppError("Reward balance not found", 404);
      }

      const claimableLamports = balance.accruedLamports - balance.paidOutLamports;
      if (claimableLamports <= BIGINT_ZERO) {
        throw new AppError("No rewards available to claim", 400);
      }

      const connection = getSolanaConnection();

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          mainWallet: { select: { publicKey: true, privateKey: true } },
        },
      });
      if (!user?.mainWallet?.privateKey) {
        throw new AppError("Main wallet not found", 404);
      }
      const mainWalletPubkey = new PublicKey(user.mainWallet.publicKey);
      const mainKeypair = Keypair.fromSecretKey(bs58.decode(user.mainWallet.privateKey));

      const rawVaultBalance = await getCreatorVaultBalance(connection, creatorWallet.keypair.publicKey);
      const vaultRewards = rawVaultBalance > RENT_EXEMPT_LAMPORTS
        ? rawVaultBalance - RENT_EXEMPT_LAMPORTS
        : BIGINT_ZERO;

      if (vaultRewards <= BIGINT_ZERO) {
        throw new AppError("No rewards available in the creator vault to collect", 400);
      }

      if (!creatorWallet.isSystemWallet && vaultRewards < MIN_CLAIMABLE_VAULT_LAMPORTS) {
        throw new AppError(
          `Vault rewards (${lamportsToSol(vaultRewards)} SOL) are too small to cover claim costs`,
          400,
        );
      }

      await ensureDevWalletFunded(connection, creatorWallet, mainKeypair, DEV_WALLET_OVERHEAD_LAMPORTS);

      const claimRecord = await appTransactionService.create({
        userId,
        type: "REWARD_CLAIM",
        source: "CREATOR_REWARD",
        tokenPublicKey,
        walletPublicKey: creatorWallet.publicKey,
        intentSolAmount: lamportsToSol(vaultRewards),
      });
      const claimTrackId = claimRecord.id;

      let pumpClaimedLamports = BIGINT_ZERO;

      try {
        const { signature, claimedLamports } = await claimFromPump(
          connection,
          creatorWallet.keypair,
        );
        pumpClaimedLamports = claimedLamports;

        await appTransactionService.confirm(claimTrackId, {
          signature,
          blockTime: new Date(),
        });
        await settleSignature({
          signature,
          rows: [{ id: claimTrackId, walletPublicKey: creatorWallet.publicKey }],
          connection,
        }).catch(() => {});

        log.info("Pump claim successful", {
          signature,
          claimedLamports: claimedLamports.toString(),
        });

        if (claimedLamports <= BIGINT_ZERO) {
          throw new AppError("Creator vault was empty — no rewards were collected. Try again later.", 400);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await appTransactionService.fail(claimTrackId, { errorMessage: msg }).catch(() => {});
        if (error instanceof AppError) throw error;
        throw new AppError("Failed to collect rewards from Pump. Please try again.", 500);
      }

      const devBalanceAfterClaim = BigInt(
        await retryRpc(() =>
          connection.getBalance(creatorWallet.keypair.publicKey, "confirmed"),
        ),
      );
      const maxPayable = devBalanceAfterClaim - RENT_EXEMPT_LAMPORTS - TX_FEE_LAMPORTS;
      const payoutLamports = maxPayable > BIGINT_ZERO ? maxPayable : BIGINT_ZERO;

      if (payoutLamports <= BIGINT_ZERO) {
        throw new AppError("Claimed amount is too small to cover transaction fees", 400);
      }

      const rewardsFromVault = pumpClaimedLamports + TX_FEE_LAMPORTS;
      const ledgerDeduction = rewardsFromVault < claimableLamports ? rewardsFromVault : claimableLamports;

      const isSelfPayout = creatorWallet.publicKey === user.mainWallet.publicKey;
      const payoutTrackRows: { id: string; walletPublicKey: string }[] = [];
      const payoutSenderRecord = await appTransactionService.create({
        userId,
        type: "REWARD_PAYOUT",
        source: "CREATOR_REWARD",
        tokenPublicKey,
        walletPublicKey: creatorWallet.publicKey,
        fromAddress: creatorWallet.publicKey,
        toAddress: user.mainWallet.publicKey,
        intentSolAmount: isSelfPayout ? 0 : -lamportsToSol(payoutLamports),
      });
      payoutTrackRows.push({
        id: payoutSenderRecord.id,
        walletPublicKey: creatorWallet.publicKey,
      });
      if (!isSelfPayout) {
        const payoutReceiverRecord = await appTransactionService.create({
          userId,
          type: "REWARD_PAYOUT",
          source: "CREATOR_REWARD",
          tokenPublicKey,
          walletPublicKey: user.mainWallet.publicKey,
          fromAddress: creatorWallet.publicKey,
          toAddress: user.mainWallet.publicKey,
          intentSolAmount: lamportsToSol(payoutLamports),
        });
        payoutTrackRows.push({
          id: payoutReceiverRecord.id,
          walletPublicKey: user.mainWallet.publicKey,
        });
      }
      const payoutTrackIds = payoutTrackRows.map((r) => r.id);

      try {
        const payoutSignature = await payoutToMainWallet(
          connection,
          creatorWallet.keypair,
          mainWalletPubkey,
          payoutLamports,
        );

        await prisma.creatorRewardBalance.update({
          where: { userId_tokenPublicKey: { userId, tokenPublicKey } },
          data: {
            paidOutLamports: { increment: ledgerDeduction },
          },
        });

        await appTransactionService.confirmMany(payoutTrackIds, {
          signature: payoutSignature,
          blockTime: new Date(),
        });
        await settleSignature({
          signature: payoutSignature,
          rows: payoutTrackRows,
          connection,
        }).catch(() => {});

        invalidateStatsCache(tokenPublicKey);

        log.info("Reward payout successful", {
          tokenPublicKey,
          payoutSignature,
          payoutLamports: payoutLamports.toString(),
          ledgerDeduction: ledgerDeduction.toString(),
          pumpClaimedLamports: pumpClaimedLamports.toString(),
        });

        return {
          success: true,
          payoutSignature,
          payoutSol: lamportsToSol(payoutLamports),
          transferFeeSol: lamportsToSol(TX_FEE_LAMPORTS),
          totalClaimedSol: lamportsToSol(ledgerDeduction),
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await appTransactionService.failMany(payoutTrackIds, { errorMessage: msg }).catch(() => {});
        if (error instanceof AppError) throw error;
        throw new AppError("Reward payout failed. Please try again.", 500);
      }
    });
  },
};
