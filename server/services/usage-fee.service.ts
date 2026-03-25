import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionExpiredBlockheightExceededError,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/config/env";
import { getSolanaConnection } from "@/lib/solana/connection";
import { AppError } from "@/server/errors";
import { logger } from "@/lib/logger";
import { rpcConfig } from "@/lib/config/rpc.config";
import { retryRpcWithTimeout } from "@/lib/utils/rpc-retry";
import { testRunLogService } from "@/server/services/test-run-log.service";

type CollectUsageFeeInput = {
  userId: string;
  totalFeeSol: number;
  reason: string;
};

type CollectUsageFeeResult = {
  skipped: boolean;
  signature: string | null;
  fromPublicKey: string;
  toPublicKey: string;
  amountSol: number;
  amountLamports: number;
  reason: string;
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
    const connection = getSolanaConnection();

    if (sender.publicKey.equals(collectorPublicKey)) {
      return {
        skipped: true,
        signature: null,
        fromPublicKey: sender.publicKey.toBase58(),
        toPublicKey: collectorPublicKey.toBase58(),
        amountSol: input.totalFeeSol,
        amountLamports,
        reason: input.reason,
      };
    }

    const sendTransfer = async () => {
      const { blockhash, lastValidBlockHeight } = await retryRpcWithTimeout(
        () => connection.getLatestBlockhash("confirmed"),
        rpcConfig.tuning.rpcTimeoutMs
      );
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: collectorPublicKey,
          lamports: amountLamports,
        })
      );
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      transaction.feePayer = sender.publicKey;
      return await retryRpcWithTimeout(
        () =>
          sendAndConfirmTransaction(connection, transaction, [sender], {
            commitment: "confirmed",
          }),
        rpcConfig.tuning.confirmTimeoutMs
      );
    };

    let signature: string;
    try {
      signature = await sendTransfer();
    } catch (error) {
      if (error instanceof TransactionExpiredBlockheightExceededError) {
        signature = await sendTransfer();
      } else if (isInsufficientBalanceError(error)) {
        throw new AppError(
          "Insufficient balance in your main wallet to purchase the Pro plan.",
          400
        );
      } else {
        throw error;
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
    });
    await testRunLogService.appendServerEvent({
      eventType: "wallet_transaction",
      source: "usage-fee.service",
      action: "usage-fee.collect",
      userId: input.userId,
      wallets: [sender.publicKey.toBase58(), collectorPublicKey.toBase58()],
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
    };
  },
};
