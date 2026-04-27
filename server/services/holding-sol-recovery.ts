import "server-only";

import {
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type Connection,
} from "@solana/web3.js";
import bs58 from "bs58";
import { appTransactionService } from "@/server/services/app-transaction.service";
import { settleSignature } from "@/server/services/app-transaction-settler";
import { testRunLogService } from "@/server/services/test-run-log.service";
import {
  computeRecoverableLamports,
  computeSponsoredRecoverableLamports,
  resolveBatchReclaimMode,
} from "@/lib/utils/sol-recovery";

export type SolRecoveryWallet = {
  publicKey: string;
  privateKey: string;
  isSystemWallet?: boolean;
};

type RecoverySource = "HOLDING" | "EXIT";

type RecoverWalletSolBalancesParams = {
  connection: Connection;
  wallets: SolRecoveryWallet[];
  mainWalletKeypair: Keypair;
  source: RecoverySource;
  logSource: string;
  logAction: string;
  preserveRentExemptMinimum: boolean;
  userId?: string;
  tokenPublicKey?: string;
  referenceId?: string;
  concurrency?: number;
};

type SweepSystemDevRealizedSolParams = {
  connection: Connection;
  sellSignature: string;
  systemDevKeypair: Keypair;
  mainWalletKeypair: Keypair;
  source: RecoverySource;
  logSource: string;
  logAction: string;
  userId?: string;
  tokenPublicKey?: string;
  referenceId?: string;
};

type SolRecoveryResultItem = {
  walletPublicKey: string;
  status: "SKIPPED" | "RECOVERED" | "FAILED";
  recoveredLamports: number;
  error?: string;
};

export type RecoverWalletSolBalancesResult = {
  recovered: number;
  failed: number;
  totalLamports: number;
  totalSol: number;
  reclaimMode: "main-sponsored" | "source-funded";
  results: SolRecoveryResultItem[];
};

export type SweepSystemDevRealizedSolResult =
  | { status: "SKIPPED"; sweptLamports: 0; signature: null }
  | { status: "SWEEPED"; sweptLamports: number; signature: string };

export function resolveReturnSolToMainWallet(
  wallets: Array<{ isSystemWallet?: boolean }>,
  requestedReturnSolToMainWallet: boolean
) {
  return (
    wallets.some((wallet) => wallet.isSystemWallet) ||
    requestedReturnSolToMainWallet
  );
}

export async function recoverWalletSolBalances({
  connection,
  wallets,
  mainWalletKeypair,
  source,
  logSource,
  logAction,
  preserveRentExemptMinimum,
  userId,
  tokenPublicKey,
  referenceId,
  concurrency = 2,
}: RecoverWalletSolBalancesParams): Promise<RecoverWalletSolBalancesResult> {
  const rentExemptMinimumLamports = preserveRentExemptMinimum
    ? await connection.getMinimumBalanceForRentExemption(0, "confirmed")
    : 0;
  const walletBalances = new Map<string, number>();

  await Promise.all(
    wallets.map(async (wallet) => {
      if (wallet.publicKey === mainWalletKeypair.publicKey.toBase58()) {
        walletBalances.set(wallet.publicKey, 0);
        return;
      }

      const owner = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
      const balanceLamports = await connection.getBalance(owner.publicKey);
      walletBalances.set(wallet.publicKey, balanceLamports);
    })
  );

  const firstRecoverableWallet = wallets.find(
    (wallet) => (walletBalances.get(wallet.publicKey) ?? 0) > 0
  );
  let sponsoredFeeLamports = 0;

  if (firstRecoverableWallet) {
    const owner = Keypair.fromSecretKey(
      bs58.decode(firstRecoverableWallet.privateKey)
    );
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");
    const sponsoredFeeTransaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: mainWalletKeypair.publicKey,
        lamports: 1,
      })
    );
    sponsoredFeeTransaction.feePayer = mainWalletKeypair.publicKey;
    sponsoredFeeTransaction.recentBlockhash = latestBlockhash.blockhash;
    const sponsoredFee = await connection.getFeeForMessage(
      sponsoredFeeTransaction.compileMessage(),
      "confirmed"
    );
    sponsoredFeeLamports = sponsoredFee.value ?? 5000;
  }

  const mainWalletBalanceLamports = await connection.getBalance(
    mainWalletKeypair.publicKey
  );
  const reclaimMode = resolveBatchReclaimMode({
    mainWalletBalanceLamports,
    walletBalancesLamports: wallets.map(
      (wallet) => walletBalances.get(wallet.publicKey) ?? 0
    ),
    sponsoredFeeLamports,
  });

  const results: SolRecoveryResultItem[] = [];
  let index = 0;

  async function processWallet(wallet: SolRecoveryWallet) {
    if (wallet.publicKey === mainWalletKeypair.publicKey.toBase58()) {
      results.push({
        walletPublicKey: wallet.publicKey,
        status: "SKIPPED",
        recoveredLamports: 0,
      });
      return;
    }

    try {
      const owner = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
      const balanceLamports = walletBalances.get(wallet.publicKey) ?? 0;

      if (balanceLamports <= 0) {
        results.push({
          walletPublicKey: wallet.publicKey,
          status: "SKIPPED",
          recoveredLamports: 0,
        });
        return;
      }

      const feeTransaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: mainWalletKeypair.publicKey,
          lamports: 1,
        })
      );
      feeTransaction.feePayer = owner.publicKey;
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      feeTransaction.recentBlockhash = latestBlockhash.blockhash;
      const fee = await connection.getFeeForMessage(
        feeTransaction.compileMessage(),
        "confirmed"
      );
      const feeLamports = fee.value ?? 5000;
      const lamports =
        reclaimMode === "main-sponsored"
          ? computeSponsoredRecoverableLamports({
              balanceLamports,
              feeLamports: sponsoredFeeLamports,
            })
          : preserveRentExemptMinimum
            ? computeRecoverableLamports({
                balanceLamports,
                feeLamports,
                rentExemptMinimumLamports,
              })
            : Math.max(balanceLamports - feeLamports, 0);

      if (lamports <= 0) {
        results.push({
          walletPublicKey: wallet.publicKey,
          status: "SKIPPED",
          recoveredLamports: 0,
        });
        return;
      }

      const transferTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: mainWalletKeypair.publicKey,
          lamports,
        })
      );
      transferTx.recentBlockhash = latestBlockhash.blockhash;
      transferTx.feePayer =
        reclaimMode === "main-sponsored"
          ? mainWalletKeypair.publicKey
          : owner.publicKey;

      const mainPkRecovery = mainWalletKeypair.publicKey.toBase58();
      const intentSolRecovery = lamports / 1_000_000_000;
      const isSelfRecovery = wallet.publicKey === mainPkRecovery;
      const returnTrackRows: { id: string; walletPublicKey: string }[] = [];
      if (userId) {
        const senderId = await appTransactionService
          .create({
            userId,
            type: "TRANSFER_RETURN",
            source,
            tokenPublicKey,
            walletPublicKey: wallet.publicKey,
            fromAddress: wallet.publicKey,
            toAddress: mainPkRecovery,
            intentSolAmount: isSelfRecovery ? 0 : -intentSolRecovery,
            referenceId,
          })
          .then((result) => result.id)
          .catch(() => null);
        if (senderId)
          returnTrackRows.push({ id: senderId, walletPublicKey: wallet.publicKey });
        if (!isSelfRecovery) {
          const receiverId = await appTransactionService
            .create({
              userId,
              type: "TRANSFER_RETURN",
              source,
              tokenPublicKey,
              walletPublicKey: mainPkRecovery,
              fromAddress: wallet.publicKey,
              toAddress: mainPkRecovery,
              intentSolAmount: intentSolRecovery,
              referenceId,
            })
            .then((result) => result.id)
            .catch(() => null);
          if (receiverId)
            returnTrackRows.push({ id: receiverId, walletPublicKey: mainPkRecovery });
        }
      }

      try {
        const signature = await sendAndConfirmTransaction(
          connection,
          transferTx,
          reclaimMode === "main-sponsored"
            ? [mainWalletKeypair, owner]
            : [owner],
          {
            commitment: "confirmed",
          }
        );
        if (returnTrackRows.length > 0) {
          await appTransactionService
            .confirmMany(
              returnTrackRows.map((r) => r.id),
              { signature }
            )
            .catch(() => {});
          await settleSignature({
            signature,
            rows: returnTrackRows,
            connection,
          }).catch(() => {});
        }
        await testRunLogService.appendServerEvent({
          eventType: "wallet_transaction",
          source: logSource,
          action: logAction,
          wallets: [wallet.publicKey, mainWalletKeypair.publicKey.toBase58()],
          signature,
          status: "submitted",
          expectedValue: {
            recoverableLamports: lamports,
            reclaimMode,
          },
          actualValue: {
            walletPublicKey: wallet.publicKey,
            recoveredLamports: lamports,
          },
        });

        results.push({
          walletPublicKey: wallet.publicKey,
          status: "RECOVERED",
          recoveredLamports: lamports,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (returnTrackRows.length > 0) {
          await appTransactionService
            .failMany(
              returnTrackRows.map((r) => r.id),
              { errorMessage: message }
            )
            .catch(() => {});
        }
        results.push({
          walletPublicKey: wallet.publicKey,
          status: "FAILED",
          recoveredLamports: 0,
          error: message,
        });
      }
    } catch (error) {
      results.push({
        walletPublicKey: wallet.publicKey,
        status: "FAILED",
        recoveredLamports: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, wallets.length)) },
    async () => {
      while (index < wallets.length) {
        const currentIndex = index;
        index += 1;
        const wallet = wallets[currentIndex];
        if (!wallet) break;
        await processWallet(wallet);
      }
    }
  );

  await Promise.all(workers);

  const recovered = results.filter((result) => result.status === "RECOVERED");
  const failed = results.filter((result) => result.status === "FAILED");
  const totalLamports = recovered.reduce(
    (sum, result) => sum + result.recoveredLamports,
    0
  );

  return {
    recovered: recovered.length,
    failed: failed.length,
    totalLamports,
    totalSol: totalLamports / 1_000_000_000,
    reclaimMode,
    results,
  };
}

export async function sweepSystemDevRealizedSol({
  connection,
  sellSignature,
  systemDevKeypair,
  mainWalletKeypair,
  source,
  logSource,
  logAction,
  userId,
  tokenPublicKey,
  referenceId,
}: SweepSystemDevRealizedSolParams): Promise<SweepSystemDevRealizedSolResult> {
  let tx: Awaited<ReturnType<Connection["getTransaction"]>> = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    tx = await connection.getTransaction(sellSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!tx?.meta) {
    return { status: "SKIPPED", sweptLamports: 0, signature: null };
  }

  const accountKeys = tx.transaction.message.getAccountKeys();
  const sellerIndex = accountKeys.staticAccountKeys.findIndex(
    (key) => key.toBase58() === systemDevKeypair.publicKey.toBase58()
  );

  if (sellerIndex < 0) {
    return { status: "SKIPPED", sweptLamports: 0, signature: null };
  }

  const preLamports = tx.meta.preBalances[sellerIndex] ?? 0;
  const postLamports = tx.meta.postBalances[sellerIndex] ?? 0;
  const realizedLamports = postLamports - preLamports;

  if (realizedLamports <= 0) {
    return { status: "SKIPPED", sweptLamports: 0, signature: null };
  }

  const transferFeeLamports = 5000;
  const sweepLamports = realizedLamports - transferFeeLamports;

  if (sweepLamports <= 0) {
    return { status: "SKIPPED", sweptLamports: 0, signature: null };
  }

  const sweepTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: systemDevKeypair.publicKey,
      toPubkey: mainWalletKeypair.publicKey,
      lamports: sweepLamports,
    })
  );
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  sweepTx.recentBlockhash = blockhash;
  sweepTx.lastValidBlockHeight = lastValidBlockHeight;
  sweepTx.feePayer = systemDevKeypair.publicKey;

  const sweepDevPk = systemDevKeypair.publicKey.toBase58();
  const sweepMainPk = mainWalletKeypair.publicKey.toBase58();
  const sweepIntent = sweepLamports / 1_000_000_000;
  const sweepIsSelf = sweepDevPk === sweepMainPk;
  const sweepTrackRows: { id: string; walletPublicKey: string }[] = [];
  if (userId) {
    const senderId = await appTransactionService
      .create({
        userId,
        type: "TRANSFER_RETURN",
        source,
        tokenPublicKey,
        walletPublicKey: sweepDevPk,
        fromAddress: sweepDevPk,
        toAddress: sweepMainPk,
        intentSolAmount: sweepIsSelf ? 0 : -sweepIntent,
        referenceId,
      })
      .then((r) => r.id)
      .catch(() => null);
    if (senderId) sweepTrackRows.push({ id: senderId, walletPublicKey: sweepDevPk });
    if (!sweepIsSelf) {
      const receiverId = await appTransactionService
        .create({
          userId,
          type: "TRANSFER_RETURN",
          source,
          tokenPublicKey,
          walletPublicKey: sweepMainPk,
          fromAddress: sweepDevPk,
          toAddress: sweepMainPk,
          intentSolAmount: sweepIntent,
          referenceId,
        })
        .then((r) => r.id)
        .catch(() => null);
      if (receiverId) sweepTrackRows.push({ id: receiverId, walletPublicKey: sweepMainPk });
    }
  }

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      sweepTx,
      [systemDevKeypair],
      {
        commitment: "confirmed",
      }
    );

    if (sweepTrackRows.length > 0) {
      await appTransactionService
        .confirmMany(
          sweepTrackRows.map((r) => r.id),
          { signature }
        )
        .catch(() => {});
      await settleSignature({ signature, rows: sweepTrackRows, connection }).catch(() => {});
    }

    await testRunLogService.appendServerEvent({
      eventType: "wallet_transaction",
      source: logSource,
      action: logAction,
      wallets: [
        systemDevKeypair.publicKey.toBase58(),
        mainWalletKeypair.publicKey.toBase58(),
      ],
      signature,
      status: "submitted",
      expectedValue: {
        sweepLamports,
        sellSignature,
      },
      actualValue: {
        walletPublicKey: systemDevKeypair.publicKey.toBase58(),
        sweptLamports: sweepLamports,
      },
    });

    return {
      status: "SWEEPED",
      sweptLamports: sweepLamports,
      signature,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (sweepTrackRows.length > 0) {
      await appTransactionService
        .failMany(
          sweepTrackRows.map((r) => r.id),
          { errorMessage: message }
        )
        .catch(() => {});
    }
    throw error;
  }
}
