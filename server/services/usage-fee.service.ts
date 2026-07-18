import "server-only";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  sendAndConfirmTransaction,
  type Connection,
} from "@solana/web3.js";
import bs58 from "bs58";
import { prisma, Prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/config/env";
import { getSolanaConnection } from "@/lib/solana/connection";
import { AppError } from "@/server/errors";
import { logger } from "@/lib/logger";
import { rpcConfig } from "@/lib/config/rpc.config";
import { retryRpcWithTimeout } from "@/lib/utils/rpc-retry";
import { testRunLogService } from "@/server/services/test-run-log.service";
import { appTransactionService } from "@/server/services/app-transaction.service";
import { settleSignature } from "@/server/services/app-transaction-settler";
import type { AppTransactionSource, AppTransactionType } from "@/lib/generated/prisma/client";

type CollectUsageFeeInput = {
  userId: string;
  totalFeeSol: number;
  reason: string;
  txSource?: AppTransactionSource;
  tokenPublicKey?: string;
  referenceId?: string;
};

type FeeTransferLeg = {
  toPublicKey: string;
  amountLamports: number;
};

type ReferralPayoutSummary = {
  marketerAmountLamports: number;
  platformAmountLamports: number;
  feeShareRate: number;
};

type CollectUsageFeeResult = {
  skipped: boolean;
  signature: string | null;
  fromPublicKey: string;
  toPublicKey: string;
  amountSol: number;
  amountLamports: number;
  reason: string;
  transfers: FeeTransferLeg[];
  referralPayout: ReferralPayoutSummary | null;
};

/** Solana boundary — replaceable in seam tests. */
export const usageFeeSolana = {
  getConnection(): Connection {
    return getSolanaConnection();
  },
  async sendAndConfirm(
    connection: Connection,
    transaction: Transaction,
    signers: Keypair[]
  ): Promise<string> {
    return await sendAndConfirmTransaction(connection, transaction, signers, {
      commitment: "confirmed",
    });
  },
};

const log = logger.child({ service: "usage-fee" });

function toLamports(amountSol: number) {
  return Math.floor(amountSol * 1_000_000_000);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "";
}

function isInsufficientBalanceError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("insufficient balance") ||
    message.includes("insufficient funds") ||
    message.includes("insufficient lamports") ||
    message.includes("attempt to debit an account")
  );
}

function resolveCollectorWalletPublicKey() {
  const collectorAddress = getEnv().FEE_COLLECTOR_WALLET_ADDRESS;
  if (!collectorAddress?.trim()) {
    throw new AppError(
      "FEE_COLLECTOR_WALLET_ADDRESS is not configured",
      500
    );
  }
  try {
    return new PublicKey(collectorAddress.trim());
  } catch {
    throw new AppError("FEE_COLLECTOR_WALLET_ADDRESS is invalid", 500);
  }
}

function parseFeeCollectorPublicKey(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }
  try {
    return new PublicKey(value.trim());
  } catch {
    return null;
  }
}

type ReferralForSplit = {
  id: string;
  marketerId: string;
  marketer: {
    isEnabled: boolean;
    feeShareRate: { toString(): string } | number | string;
    feeCollectorPublicKey: string | null;
  };
} | null;

/** feeShareRate is Decimal(5,4) — scale by 10_000 for exact floor math. */
function floorMarketerShareLamports(totalLamports: number, rate: number) {
  const rateScaled = Math.round(rate * 10_000);
  if (rateScaled <= 0) {
    return 0;
  }
  return Math.floor((totalLamports * rateScaled) / 10_000);
}

function resolveReferralFeeSplit(input: {
  totalLamports: number;
  referral: ReferralForSplit;
}): {
  transfers: FeeTransferLeg[];
  payout: (ReferralPayoutSummary & {
    referralId: string;
    marketerId: string;
  }) | null;
} {
  const platformPublicKey = resolveCollectorWalletPublicKey().toBase58();
  const platformOnly = {
    transfers: [
      {
        toPublicKey: platformPublicKey,
        amountLamports: input.totalLamports,
      },
    ],
    payout: null,
  };

  const referral = input.referral;
  const marketer = referral?.marketer;
  const rate = marketer ? Number(marketer.feeShareRate) : 0;
  const marketerCollector = parseFeeCollectorPublicKey(
    marketer?.feeCollectorPublicKey
  );

  const qualifies =
    Boolean(referral) &&
    Boolean(marketer?.isEnabled) &&
    Number.isFinite(rate) &&
    rate > 0 &&
    marketerCollector !== null;

  if (!qualifies || !referral || !marketerCollector) {
    return platformOnly;
  }

  const marketerAmountLamports = floorMarketerShareLamports(
    input.totalLamports,
    rate
  );
  if (marketerAmountLamports <= 0) {
    return platformOnly;
  }

  const platformAmountLamports = input.totalLamports - marketerAmountLamports;
  return {
    transfers: [
      {
        toPublicKey: marketerCollector.toBase58(),
        amountLamports: marketerAmountLamports,
      },
      {
        toPublicKey: platformPublicKey,
        amountLamports: platformAmountLamports,
      },
    ],
    payout: {
      referralId: referral.id,
      marketerId: referral.marketerId,
      marketerAmountLamports,
      platformAmountLamports,
      feeShareRate: rate,
    },
  };
}

export const usageFeeService = {
  async collectFromMainWallet(
    input: CollectUsageFeeInput
  ): Promise<CollectUsageFeeResult> {
    const amountLamports = toLamports(input.totalFeeSol);
    if (amountLamports <= 0) {
      return {
        skipped: true,
        signature: null,
        fromPublicKey: "",
        toPublicKey: "",
        amountSol: 0,
        amountLamports: 0,
        reason: input.reason,
        transfers: [],
        referralPayout: null,
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        mainWallet: {
          select: {
            publicKey: true,
            privateKey: true,
          },
        },
      },
    });
    const mainWallet = user?.mainWallet;
    if (!mainWallet?.privateKey) {
      throw new AppError("Main wallet not accessible", 400);
    }

    const collectorPublicKey = resolveCollectorWalletPublicKey();
    const sender = Keypair.fromSecretKey(bs58.decode(mainWallet.privateKey));
    const connection = usageFeeSolana.getConnection();

    if (sender.publicKey.equals(collectorPublicKey)) {
      return {
        skipped: true,
        signature: null,
        fromPublicKey: sender.publicKey.toBase58(),
        toPublicKey: collectorPublicKey.toBase58(),
        amountSol: input.totalFeeSol,
        amountLamports,
        reason: input.reason,
        transfers: [],
        referralPayout: null,
      };
    }

    const referral = await prisma.referral.findUnique({
      where: { userId: input.userId },
      select: {
        id: true,
        marketerId: true,
        marketer: {
          select: {
            isEnabled: true,
            feeShareRate: true,
            feeCollectorPublicKey: true,
          },
        },
      },
    });

    const split = resolveReferralFeeSplit({
      totalLamports: amountLamports,
      referral,
    });

    const sendTransfer = async () => {
      const { blockhash, lastValidBlockHeight } = await retryRpcWithTimeout(
        () => connection.getLatestBlockhash("confirmed"),
        rpcConfig.tuning.rpcTimeoutMs
      );
      const transaction = new Transaction();
      for (const leg of split.transfers) {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: sender.publicKey,
            toPubkey: new PublicKey(leg.toPublicKey),
            lamports: leg.amountLamports,
          })
        );
      }
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      transaction.feePayer = sender.publicKey;
      return await retryRpcWithTimeout(
        () => usageFeeSolana.sendAndConfirm(connection, transaction, [sender]),
        rpcConfig.tuning.confirmTimeoutMs
      );
    };

    const isSubscriptionFee = input.reason === "pro.weekly" || input.reason === "developer.weekly";
    const feeType: AppTransactionType = isSubscriptionFee ? "FEE_SUBSCRIPTION" : "FEE_USAGE";
    const feeSource: AppTransactionSource = input.txSource ?? (isSubscriptionFee ? "BILLING" : "WALLET");
    const senderPk = sender.publicKey.toBase58();
    const trackId = await appTransactionService
      .create({
        userId: input.userId,
        type: feeType,
        source: feeSource,
        walletPublicKey: senderPk,
        fromAddress: senderPk,
        toAddress: collectorPublicKey.toBase58(),
        intentSolAmount: -input.totalFeeSol,
        tokenPublicKey: input.tokenPublicKey,
        referenceId: input.referenceId,
      })
      .then((r) => r.id)
      .catch(() => null);

    let signature: string;
    try {
      try {
        signature = await sendTransfer();
      } catch (error) {
        if (error instanceof TransactionExpiredBlockheightExceededError) {
          signature = await sendTransfer();
        } else if (isInsufficientBalanceError(error)) {
          throw new AppError(
            "Insufficient balance in your main wallet to complete this purchase.",
            400
          );
        } else {
          throw error;
        }
      }
      if (trackId) {
        await appTransactionService.confirm(trackId, { signature }).catch(() => {});
        await settleSignature({
          signature,
          rows: [{ id: trackId, walletPublicKey: senderPk }],
          connection,
        }).catch(() => {});
      }
    } catch (error) {
      if (trackId) await appTransactionService.fail(trackId, { errorMessage: error instanceof Error ? error.message : "Unknown error" }).catch(() => {});
      throw error;
    }

    let referralPayout: ReferralPayoutSummary | null = null;
    if (split.payout) {
      try {
        await prisma.referralPayout.create({
          data: {
            marketerId: split.payout.marketerId,
            referralId: split.payout.referralId,
            referredUserId: input.userId,
            marketerAmountLamports: BigInt(split.payout.marketerAmountLamports),
            platformAmountLamports: BigInt(split.payout.platformAmountLamports),
            totalFeeLamports: BigInt(amountLamports),
            feeShareRate: new Prisma.Decimal(split.payout.feeShareRate),
            reason: input.reason,
            txSignature: signature,
          },
        });
        referralPayout = {
          marketerAmountLamports: split.payout.marketerAmountLamports,
          platformAmountLamports: split.payout.platformAmountLamports,
          feeShareRate: split.payout.feeShareRate,
        };
      } catch (error) {
        // On-chain split already confirmed; do not fail the payer. Ops can
        // reconcile from the dual-transfer signature if the ledger write misses.
        log.error("Failed to record Referral Payout after successful fee split", {
          userId: input.userId,
          marketerId: split.payout.marketerId,
          referralId: split.payout.referralId,
          signature,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    log.info("Usage fee collected", {
      userId: input.userId,
      fromPublicKey: sender.publicKey.toBase58(),
      toPublicKey: collectorPublicKey.toBase58(),
      amountSol: input.totalFeeSol,
      amountLamports,
      signature,
      reason: input.reason,
      transferCount: split.transfers.length,
      referralPayout: Boolean(referralPayout),
    });
    await testRunLogService.appendServerEvent({
      eventType: "wallet_transaction",
      source: "usage-fee.service",
      action: "usage-fee.collect",
      userId: input.userId,
      wallets: [
        sender.publicKey.toBase58(),
        ...split.transfers.map((leg) => leg.toPublicKey),
      ],
      signature,
      status: "submitted",
      expectedValue: {
        amountSol: input.totalFeeSol,
        amountLamports,
        reason: input.reason,
      },
      actualValue: {
        fromPublicKey: sender.publicKey.toBase58(),
        toPublicKey: collectorPublicKey.toBase58(),
        amountSol: input.totalFeeSol,
        amountLamports,
        transfers: split.transfers,
      },
    });

    return {
      skipped: false,
      signature,
      fromPublicKey: sender.publicKey.toBase58(),
      toPublicKey: collectorPublicKey.toBase58(),
      amountSol: input.totalFeeSol,
      amountLamports,
      reason: input.reason,
      transfers: split.transfers,
      referralPayout,
    };
  },
};
