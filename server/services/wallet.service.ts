import "server-only";
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
import { WalletType } from "@/lib/generated/prisma/client";
import type { UserPlan } from "@/lib/generated/prisma/client";
import { getSolanaConnection } from "@/lib/solana/connection";
import { AppError } from "@/server/errors";
import { rpcConfig } from "@/lib/config/rpc.config";
import { cacheConfig } from "@/lib/config/cache.config";
import { logger } from "@/lib/logger";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { testRunLogService } from "@/server/services/test-run-log.service";
import { retryRpc, retryRpcWithTimeout } from "@/lib/utils/rpc-retry";
import { mapWithConcurrency } from "@/lib/utils/async";
import {
  computeSponsoredRecoverableLamports,
  resolveBatchReclaimMode,
} from "@/lib/utils/sol-recovery";
import {
  calculateBuyerWalletUsageFees,
  discountBuyerWalletUsageFees,
  waiveBuyerWalletUsageFees,
} from "@/lib/config/usage-fees.config";
import type {
  CreateBuyerWalletsByTokenInput,
  WalletTransferResult,
  WithdrawMainSolResult,
} from "@/server/schemas/wallet.schema";
import { withActionLock } from "@/server/security/api-abuse";
import { appTransactionService } from "@/server/services/app-transaction.service";
import { settleSignature } from "@/server/services/app-transaction-settler";
import { grpcAccessService } from "@/server/services/grpc-access.service";
import { persistGeneratedPrivateKey } from "@/server/services/private-key-persistence.service";
import { usageFeeService } from "@/server/services/usage-fee.service";
import type { AppTransactionSource } from "@/lib/generated/prisma/client";

const log = logger.child({ service: "wallet" });
const OPERATIONAL_WALLET_TYPES = [
  WalletType.BUNDLER,
  WalletType.VOLUME,
  WalletType.BUYER,
  WalletType.DISTRIBUTION,
];

export const walletService = {
  async getOperationalWalletsByToken(
    tokenPublicKey: string,
    userId: string,
    options?: { page?: number; pageSize?: number }
  ) {
    const token = await prisma.token.findFirst({
      where: { publicKey: tokenPublicKey, userId },
      select: {
        publicKey: true,
        name: true,
        symbol: true,
        imageUrl: true,
      },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const page = options?.page ?? 1;
    const pageSize = Math.min(options?.pageSize ?? 200, 200);
    const skip = (page - 1) * pageSize;
    const where = {
      tokenPublicKey,
      type: {
        in: OPERATIONAL_WALLET_TYPES,
      },
    };
    const [wallets, totalCount] = await Promise.all([
      prisma.wallet.findMany({
        where,
        select: {
          publicKey: true,
          type: true,
          balanceSol: true,
          balanceRefreshedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        skip,
        take: pageSize,
      }),
      prisma.wallet.count({ where }),
    ]);

    return {
      token: {
        publicKey: token.publicKey,
        name: token.name,
        symbol: token.symbol,
        imageUrl: token.imageUrl,
      },
      wallets,
      totalCount,
      page,
      pageSize,
    };
  },

  async getDevWalletByToken(tokenPublicKey: string, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey: tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const devWallet = await prisma.tokenDevWallet.findFirst({
      where: { tokenPublicKey },
      select: {
        wallet: {
          select: {
            publicKey: true,
            type: true,
            balanceSol: true,
            balanceRefreshedAt: true,
            createdAt: true,
            updatedAt: true,
            isSystemWallet: true,
          },
        },
      },
    });

    return devWallet?.wallet ?? null;
  },

  async getMainWallet(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        mainWallet: {
          select: {
            publicKey: true,
            type: true,
            balanceSol: true,
            balanceRefreshedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return user?.mainWallet ?? null;
  },

  async getMainWalletPrivateKey(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
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
    if (!mainWallet) {
      throw new AppError("Main wallet not found", 404);
    }

    if (!mainWallet.privateKey) {
      throw new AppError("Private key not available", 404);
    }

    return { privateKey: mainWallet.privateKey };
  },

  async createBuyerWalletsByToken(
    input: CreateBuyerWalletsByTokenInput,
    userId: string,
    userPlan: { plan: UserPlan }
  ) {
    const actionKey = `wallet:create-buyer:${userId}:${input.tokenPublicKey}`;
    return await withActionLock(actionKey, async () => {
      const token = await prisma.token.findFirst({
        where: { publicKey: input.tokenPublicKey, userId },
        select: {
          publicKey: true,
          name: true,
          symbol: true,
        },
      });

      if (!token) {
        throw new AppError("Token not found", 404);
      }

      const rawFees = calculateBuyerWalletUsageFees(input.count);
      const discountRate = grpcAccessService.getPlatformFeeDiscountRate(userPlan);
      const usageFees =
        discountRate >= 1
          ? waiveBuyerWalletUsageFees(rawFees)
          : discountRate > 0
            ? discountBuyerWalletUsageFees(rawFees, discountRate)
            : rawFees;

      const keypairs = Array.from({ length: input.count }, () =>
        Keypair.generate()
      );
      const wallets = keypairs.map((keypair) => ({
        publicKey: keypair.publicKey.toBase58(),
        privateKey: bs58.encode(keypair.secretKey),
      }));

      await Promise.all(
        wallets.map((wallet) =>
          persistGeneratedPrivateKey({
            service: "walletService",
            operation: "createBuyerWalletsByToken.generateWallet",
            publicKey: wallet.publicKey,
            privateKey: wallet.privateKey,
          })
        )
      );

      await usageFeeService.collectFromMainWallet({
        userId,
        totalFeeSol: usageFees.totalFeeSol,
        reason: "wallet.create_buyer",
        txSource: "WALLET",
        tokenPublicKey: token.publicKey,
      });

      await prisma.wallet.createMany({
        data: wallets.map((wallet) => ({
          publicKey: wallet.publicKey,
          privateKey: wallet.privateKey,
          type: WalletType.BUYER,
          tokenPublicKey: token.publicKey,
          userId,
        })),
      });

      const now = new Date();

      return {
        token,
        wallets: wallets.map((wallet) => ({
          publicKey: wallet.publicKey,
          type: WalletType.BUYER,
          balanceSol: 0,
          balanceRefreshedAt: null,
          createdAt: now,
          updatedAt: now,
        })),
        usageFees,
      };
    });
  },

  async refreshMainWalletBalance(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        mainWallet: {
          select: {
            publicKey: true,
          },
        },
      },
    });

    const mainWallet = user?.mainWallet;
    if (!mainWallet) {
      throw new AppError("Main wallet not found", 404);
    }

    const connection = getSolanaConnection();
    const walletPubkey = new PublicKey(mainWallet.publicKey);
    const solBalance = await retryRpc(() => connection.getBalance(walletPubkey));
    const balanceSol = solBalance / 1_000_000_000;

    const now = new Date();

    await prisma.wallet.update({
      where: { publicKey: mainWallet.publicKey },
      data: {
        balanceSol,
        balanceRefreshedAt: now,
      },
    });

    return {
      publicKey: mainWallet.publicKey,
      balanceSol,
      balanceRefreshedAt: now,
    };
  },

  async withdrawMainSol(
    userId: string,
    destinationPublicKey: string,
    amountSol?: number,
    useMax?: boolean,
    source?: AppTransactionSource
  ): Promise<WithdrawMainSolResult> {
    const actionKey = `wallet:withdraw-main-sol:${userId}`;
    return await withActionLock(actionKey, async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
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
      if (!mainWallet) {
        throw new AppError("Main wallet not found", 400);
      }

      const sender = Keypair.fromSecretKey(bs58.decode(mainWallet.privateKey));
      const destination = new PublicKey(destinationPublicKey);
      const connection = getSolanaConnection();

      const submitTransfer = async () => {
        const { blockhash, lastValidBlockHeight } = await retryRpcWithTimeout(
          () => connection.getLatestBlockhash("confirmed"),
          rpcConfig.tuning.rpcTimeoutMs
        );

        const [balanceLamports, feeInfo] = await Promise.all([
          retryRpcWithTimeout(
            () => connection.getBalance(sender.publicKey),
            rpcConfig.tuning.rpcTimeoutMs
          ),
          retryRpcWithTimeout(() => {
            const feeTransaction = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: sender.publicKey,
                toPubkey: destination,
                lamports: 1,
              })
            );
            feeTransaction.recentBlockhash = blockhash;
            feeTransaction.lastValidBlockHeight = lastValidBlockHeight;
            feeTransaction.feePayer = sender.publicKey;
            return connection.getFeeForMessage(
              feeTransaction.compileMessage(),
              "confirmed"
            );
          }, rpcConfig.tuning.rpcTimeoutMs),
        ]);

        const feeLamports = feeInfo.value ?? 5000;
        const requestedLamports = useMax
          ? balanceLamports - feeLamports
          : Math.floor((amountSol ?? 0) * 1_000_000_000);

        if (requestedLamports <= 0) {
          throw new AppError("Insufficient balance to withdraw", 400);
        }

        if (!useMax && requestedLamports + feeLamports > balanceLamports) {
          throw new AppError("Insufficient balance to cover amount and fee", 400);
        }

        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: sender.publicKey,
            toPubkey: destination,
            lamports: requestedLamports,
          })
        );
        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;
        transaction.feePayer = sender.publicKey;

        const signature = await retryRpcWithTimeout(
          () =>
            sendAndConfirmTransaction(connection, transaction, [sender], {
              commitment: "confirmed",
            }),
          rpcConfig.tuning.confirmTimeoutMs
        );

        return {
          signature,
          amountSol: requestedLamports / 1_000_000_000,
        };
      };

      const senderPk = sender.publicKey.toBase58();
      const trackId = await appTransactionService
        .create({
          userId,
          type: "TRANSFER_WITHDRAW",
          source: source ?? "WALLET",
          walletPublicKey: senderPk,
          fromAddress: senderPk,
          toAddress: destinationPublicKey,
          intentSolAmount: amountSol != null ? -amountSol : null,
        })
        .then((r) => r.id)
        .catch(() => null);

      let submitted: { signature: string; amountSol: number };
      try {
        try {
          submitted = await submitTransfer();
        } catch (error) {
          if (error instanceof TransactionExpiredBlockheightExceededError) {
            submitted = await submitTransfer();
          } else {
            throw error;
          }
        }
        if (trackId) {
          await appTransactionService.confirm(trackId, { signature: submitted.signature }).catch(() => {});
          await settleSignature({
            signature: submitted.signature,
            rows: [{ id: trackId, walletPublicKey: senderPk }],
            connection,
          }).catch(() => {});
        }
      } catch (error) {
        if (trackId) await appTransactionService.fail(trackId, { errorMessage: error instanceof Error ? error.message : "Unknown error" }).catch(() => {});
        throw error;
      }

      try {
        await walletService.refreshMainWalletBalance(userId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn("Post-withdraw main wallet refresh failed", {
          errorMessage: message,
        });
      }
      await testRunLogService.appendServerEvent({
        eventType: "wallet_transaction",
        source: "wallet.service",
        action: "wallet.withdrawMainSol",
        userId,
        wallets: [sender.publicKey.toBase58(), destinationPublicKey],
        signature: submitted.signature,
        status: "submitted",
        expectedValue: {
          requestedAmountSol: amountSol ?? null,
          useMax: Boolean(useMax),
        },
        actualValue: {
          amountSol: submitted.amountSol,
          destinationPublicKey,
        },
      });

      return {
        signature: submitted.signature,
        amountSol: submitted.amountSol,
        destinationPublicKey,
      };
    });
  },

  async getWalletByToken(
    tokenPublicKey: string,
    walletPublicKey: string,
    userId: string
  ) {
    const [token, user] = await Promise.all([
      prisma.token.findFirst({
        where: { publicKey: tokenPublicKey, userId },
        select: {
          publicKey: true,
          name: true,
          symbol: true,
          imageUrl: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          mainWallet: {
            select: {
              publicKey: true,
              type: true,
              balanceSol: true,
              balanceRefreshedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      }),
    ]);

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const mainWallet = user?.mainWallet ?? null;
    if (mainWallet?.publicKey === walletPublicKey) {
      return {
        token: {
          publicKey: token.publicKey,
          name: token.name,
          symbol: token.symbol,
          imageUrl: token.imageUrl,
        },
        wallet: mainWallet,
        mainWallet,
      };
    }

    const wallet = await prisma.wallet.findUnique({
      where: { publicKey: walletPublicKey },
      select: {
        publicKey: true,
        type: true,
        balanceSol: true,
        balanceRefreshedAt: true,
        createdAt: true,
        updatedAt: true,
        tokenPublicKey: true,
        isSystemWallet: true,
      },
    });

    if (!wallet) {
      throw new AppError("Wallet not found", 404);
    }

    if (wallet.type === "DEV") {
      const devLink = await prisma.tokenDevWallet.findUnique({
        where: {
          tokenPublicKey_walletPublicKey: {
            tokenPublicKey,
            walletPublicKey,
          },
        },
        select: { walletPublicKey: true },
      });
      if (!devLink) {
        throw new AppError("Wallet not found", 404);
      }
    } else if (wallet.tokenPublicKey !== tokenPublicKey) {
      throw new AppError("Wallet not found", 404);
    }

    return {
      token: {
        publicKey: token.publicKey,
        name: token.name,
        symbol: token.symbol,
        imageUrl: token.imageUrl,
      },
      wallet: {
        publicKey: wallet.publicKey,
        type: wallet.type,
        balanceSol: wallet.balanceSol,
        balanceRefreshedAt: wallet.balanceRefreshedAt,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
        isSystemWallet: wallet.isSystemWallet,
      },
      mainWallet,
    };
  },
  async getWalletPrivateKey(
    tokenPublicKey: string,
    walletPublicKey: string,
    userId: string
  ) {
    const [token, user] = await Promise.all([
      prisma.token.findFirst({
        where: { publicKey: tokenPublicKey, userId },
        select: { publicKey: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          mainWallet: {
            select: {
              publicKey: true,
              privateKey: true,
            },
          },
        },
      }),
    ]);

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const mainWallet = user?.mainWallet ?? null;
    if (mainWallet?.publicKey === walletPublicKey) {
      if (!mainWallet.privateKey) {
        throw new AppError("Private key not available", 404);
      }
      return { privateKey: mainWallet.privateKey };
    }

    const wallet = await prisma.wallet.findUnique({
      where: { publicKey: walletPublicKey },
      select: {
        publicKey: true,
        type: true,
        tokenPublicKey: true,
        privateKey: true,
        isSystemWallet: true,
      },
    });

    if (!wallet) {
      throw new AppError("Wallet not found", 404);
    }

    if (wallet.isSystemWallet) {
      throw new AppError("Private key not available for system wallets", 403);
    }

    if (wallet.type === "DEV") {
      const devLink = await prisma.tokenDevWallet.findUnique({
        where: {
          tokenPublicKey_walletPublicKey: {
            tokenPublicKey,
            walletPublicKey,
          },
        },
        select: { walletPublicKey: true },
      });
      if (!devLink) {
        throw new AppError("Wallet not found", 404);
      }
    } else if (wallet.tokenPublicKey !== tokenPublicKey) {
      throw new AppError("Wallet not found", 404);
    }

    if (!wallet.privateKey) {
      throw new AppError("Private key not available", 404);
    }

    return { privateKey: wallet.privateKey };
  },

  async refreshWalletBalances(
    tokenPublicKey: string,
    userId: string,
    walletPublicKeys?: string[],
    force = false,
    reason?: string
  ) {
    const token = await prisma.token.findFirst({
      where: { publicKey: tokenPublicKey, userId },
      select: {
        publicKey: true,
      },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const [operationalWallets, devWallet, user] = await Promise.all([
      prisma.wallet.findMany({
        where: {
          tokenPublicKey,
          type: { in: OPERATIONAL_WALLET_TYPES },
        },
        select: {
          publicKey: true,
          balanceSol: true,
          balanceRefreshedAt: true,
          type: true,
        },
      }),
      prisma.tokenDevWallet.findFirst({
        where: { tokenPublicKey },
        select: {
          wallet: {
            select: {
              publicKey: true,
              balanceSol: true,
              balanceRefreshedAt: true,
              type: true,
              isSystemWallet: true,
            },
          },
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          mainWallet: {
            select: {
              publicKey: true,
              balanceSol: true,
              balanceRefreshedAt: true,
              type: true,
            },
          },
        },
      }),
    ]);

    const devWalletForRefresh =
      devWallet?.wallet && !devWallet.wallet.isSystemWallet
        ? devWallet.wallet
        : null;

    const availableWallets: Array<{
      publicKey: string;
      balanceSol: number;
      balanceRefreshedAt: Date | null;
      type: WalletType;
    }> = Array.from(
      new Map(
        [
          ...(user?.mainWallet ? [user.mainWallet] : []),
          ...(devWalletForRefresh ? [devWalletForRefresh] : []),
          ...operationalWallets,
        ]
          .map((wallet) => ({
            publicKey: wallet.publicKey,
            balanceSol: Number(wallet.balanceSol ?? 0),
            balanceRefreshedAt: wallet.balanceRefreshedAt,
            type: wallet.type,
          }))
          .map((wallet) => [wallet.publicKey, wallet])
      ).values()
    );

    const allowedWallets = new Map(
      availableWallets.map((wallet) => [wallet.publicKey, wallet])
    );
    const targeted = Boolean(walletPublicKeys?.length);
    const requestedKeys = targeted
      ? Array.from(new Set(walletPublicKeys))
      : availableWallets.map((wallet) => wallet.publicKey);
    const skippedNotAllowed = targeted
      ? requestedKeys.filter((key) => !allowedWallets.has(key))
      : [];
    const requestedWallets = targeted
      ? requestedKeys
          .map((key) => allowedWallets.get(key))
          .filter((wallet): wallet is (typeof availableWallets)[number] => !!wallet)
      : availableWallets;
    const beforeSnapshot = requestedWallets.map((wallet) => ({
      publicKey: wallet.publicKey,
      walletType: wallet.type,
      balanceSol: wallet.balanceSol,
      balanceRefreshedAt: wallet.balanceRefreshedAt?.toISOString() ?? null,
      dataSource: "database-snapshot",
    }));

    const now = new Date();
    const cooldownMs = cacheConfig.cooldownMs.walletBalances;
    const skippedCooldown = force
      ? []
      : requestedWallets
          .filter((wallet) => {
            if (!wallet.balanceRefreshedAt) return false;
            return (
              now.getTime() - wallet.balanceRefreshedAt.getTime() < cooldownMs
            );
          })
          .map((wallet) => wallet.publicKey);
    const targetWallets = force
      ? requestedWallets
      : requestedWallets.filter(
          (wallet) => !skippedCooldown.includes(wallet.publicKey)
        );

    if (targetWallets.length === 0) {
      await testRunLogService.appendServerEvent({
        eventType: "wallet_balance_snapshot",
        source: "wallet.service",
        tokenPublicKey: token.publicKey,
        action: reason ?? "wallet.refreshWalletBalances",
        userId,
        dataSource: "database-snapshot",
        wallets: requestedKeys,
        balancesBefore: beforeSnapshot,
        balancesAfter: [],
        summary: {
          refreshedCount: 0,
          skippedCooldownCount: skippedCooldown.length,
          skippedNotAllowedCount: skippedNotAllowed.length,
          requestedCount: requestedKeys.length,
          targeted,
          force,
          status: "skipped",
        },
      });
      return {
        refreshed: [],
        skippedCooldown,
        skippedNotAllowed,
        requestedCount: requestedKeys.length,
        targeted,
      };
    }

    const solBalanceMap = new Map<string, number>();
    const connection = getSolanaConnection();
    const validWallets: {
      wallet: (typeof targetWallets)[number];
      key: PublicKey;
    }[] = [];
    for (const wallet of targetWallets) {
      try {
        validWallets.push({
          wallet,
          key: new PublicKey(wallet.publicKey),
        });
      } catch {
        solBalanceMap.set(wallet.publicKey, 0);
      }
    }

    const batchSize = Math.max(1, rpcConfig.tuning.solBalanceBatchSize);
    for (let i = 0; i < validWallets.length; i += batchSize) {
      const batch = validWallets.slice(i, i + batchSize);
      const infos = await retryRpc(() =>
        connection.getMultipleAccountsInfo(
          batch.map((item) => item.key),
          "confirmed"
        )
      );
      infos.forEach((info, index) => {
        const walletKey = batch[index]?.wallet.publicKey;
        if (!walletKey) return;
        solBalanceMap.set(walletKey, info ? info.lamports : 0);
      });
    }

    const balances = targetWallets.map((wallet) => ({
      publicKey: wallet.publicKey,
      balanceSol: (solBalanceMap.get(wallet.publicKey) ?? 0) / 1_000_000_000,
    }));

    const updateBatchSize = 50;
    for (let i = 0; i < balances.length; i += updateBatchSize) {
      const batch = balances.slice(i, i + updateBatchSize);
      await prisma.$transaction(
        batch.map((balance) =>
          prisma.wallet.update({
            where: { publicKey: balance.publicKey },
            data: {
              balanceSol: balance.balanceSol,
              balanceRefreshedAt: now,
            },
          })
        )
      );
    }

    await refreshCacheService.touch({
      userId,
      tokenPublicKey: token.publicKey,
      scope: "WALLETS",
      refreshedAt: now,
    });

    await testRunLogService.appendServerEvent({
      eventType: "wallet_balance_snapshot",
      source: "wallet.service",
      tokenPublicKey: token.publicKey,
      action: reason ?? "wallet.refreshWalletBalances",
      userId,
      dataSource: "rpc",
      wallets: requestedKeys,
      balancesBefore: beforeSnapshot,
      balancesAfter: balances.map((balance) => ({
        ...balance,
        balanceRefreshedAt: now.toISOString(),
        dataSource: "rpc",
      })),
      summary: {
        refreshedCount: balances.length,
        skippedCooldownCount: skippedCooldown.length,
        skippedNotAllowedCount: skippedNotAllowed.length,
        requestedCount: requestedKeys.length,
        targeted,
        force,
      },
    });

    return {
      refreshed: balances.map((balance) => ({
        publicKey: balance.publicKey,
        balanceSol: balance.balanceSol,
        balanceRefreshedAt: now,
      })),
      skippedCooldown,
      skippedNotAllowed,
      requestedCount: requestedKeys.length,
      targeted,
    };
  },

  async sendSolFromMainWallet(
    tokenPublicKey: string,
    userId: string,
    walletPublicKeys: string[],
    amountSol: number,
    source?: AppTransactionSource
  ): Promise<WalletTransferResult> {
    const actionKey = `wallet:send-sol:${userId}:${tokenPublicKey}`;
    return await withActionLock(actionKey, async () => {
    const token = await prisma.token.findFirst({
      where: { publicKey: tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const [user, operationalWallets, devWallet] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          mainWallet: { select: { publicKey: true, privateKey: true } },
        },
      }),
      prisma.wallet.findMany({
        where: {
          tokenPublicKey,
          type: { in: OPERATIONAL_WALLET_TYPES },
        },
        select: { publicKey: true },
      }),
      prisma.tokenDevWallet.findFirst({
        where: { tokenPublicKey },
        select: { wallet: { select: { publicKey: true, isSystemWallet: true } } },
      }),
    ]);

    const mainWallet = user?.mainWallet;
    if (!mainWallet) {
      throw new AppError("Main wallet not found", 400);
    }

    const devWalletPublicKey =
      devWallet?.wallet?.publicKey &&
      devWallet.wallet.publicKey !== mainWallet.publicKey &&
      !devWallet.wallet.isSystemWallet
        ? devWallet.wallet.publicKey
        : null;
    const allowedWallets = new Set([
      ...operationalWallets.map((wallet) => wallet.publicKey),
      ...(devWalletPublicKey ? [devWalletPublicKey] : []),
    ]);
    const targets = Array.from(new Set(walletPublicKeys)).filter(
      (publicKey) =>
        publicKey !== mainWallet.publicKey && allowedWallets.has(publicKey)
    );

    if (targets.length === 0) {
      throw new AppError("No valid target wallets provided", 400);
    }

    const connection = getSolanaConnection();
    const sender = Keypair.fromSecretKey(bs58.decode(mainWallet.privateKey));
    const lamports = Math.floor(amountSol * 1_000_000_000);

    const transferConcurrency = rpcConfig.tuning.transferConcurrency;
    const results = await mapWithConcurrency(
      targets,
      transferConcurrency,
      async (publicKey) => {
        const senderPk = sender.publicKey.toBase58();
        const trackRows: { id: string; walletPublicKey: string }[] = [];
        const senderId = await appTransactionService
          .create({
            userId,
            type: "TRANSFER_FUND",
            source: source ?? "WALLET",
            tokenPublicKey,
            walletPublicKey: senderPk,
            fromAddress: senderPk,
            toAddress: publicKey,
            intentSolAmount: -amountSol,
          })
          .then((r) => r.id)
          .catch(() => null);
        if (senderId) trackRows.push({ id: senderId, walletPublicKey: senderPk });
        const receiverId = await appTransactionService
          .create({
            userId,
            type: "TRANSFER_FUND",
            source: source ?? "WALLET",
            tokenPublicKey,
            walletPublicKey: publicKey,
            fromAddress: senderPk,
            toAddress: publicKey,
            intentSolAmount: amountSol,
          })
          .then((r) => r.id)
          .catch(() => null);
        if (receiverId) trackRows.push({ id: receiverId, walletPublicKey: publicKey });
        try {
          const destination = new PublicKey(publicKey);
          const sendTransfer = async () => {
            const { blockhash, lastValidBlockHeight } =
              await retryRpcWithTimeout(
                () => connection.getLatestBlockhash("confirmed"),
                rpcConfig.tuning.rpcTimeoutMs
              );
            const transaction = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: sender.publicKey,
                toPubkey: destination,
                lamports,
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

          const settleAfterConfirm = async (signature: string) => {
            if (trackRows.length > 0) {
              await appTransactionService
                .confirmMany(
                  trackRows.map((r) => r.id),
                  { signature }
                )
                .catch(() => {});
              await settleSignature({ signature, rows: trackRows, connection }).catch(() => {});
            }
          };
          const failAllTracked = async (message: string) => {
            if (trackRows.length > 0) {
              await appTransactionService
                .failMany(
                  trackRows.map((r) => r.id),
                  { errorMessage: message }
                )
                .catch(() => {});
            }
          };
          try {
            const signature = await sendTransfer();
            await settleAfterConfirm(signature);
            return {
              publicKey,
              status: "SUBMITTED" as const,
              signature,
            };
          } catch (error) {
            if (error instanceof TransactionExpiredBlockheightExceededError) {
              try {
                const signature = await sendTransfer();
                await settleAfterConfirm(signature);
                return {
                  publicKey,
                  status: "SUBMITTED" as const,
                  signature,
                };
              } catch (retryError) {
                const message =
                  retryError instanceof Error
                    ? retryError.message
                    : String(retryError);
                log.error("Retry transfer failed", { errorMessage: message });
                await failAllTracked(message);
                return {
                  publicKey,
                  status: "FAILED" as const,
                  signature: null,
                  error: message,
                };
              }
            }
            const message =
              error instanceof Error ? error.message : String(error);
            log.error("Transfer failed", { errorMessage: message });
            await failAllTracked(message);
            return {
              publicKey,
              status: "FAILED" as const,
              signature: null,
              error: message,
            };
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            publicKey,
            status: "FAILED" as const,
            signature: null,
            error: message,
          };
        }
      }
    );

    const refreshWalletPublicKeys = Array.from(
      new Set([
        mainWallet.publicKey,
        ...results
          .filter((result) => result.status === "SUBMITTED")
          .map((result) => result.publicKey),
      ])
    );
    try {
      await walletService.refreshWalletBalances(
        tokenPublicKey,
        userId,
        refreshWalletPublicKeys,
        true,
        "wallet.sendSolFromMainWallet"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn("Post-send balance refresh failed", { errorMessage: message });
    }

    const submittedCount = results.filter(
      (result) => result.status === "SUBMITTED"
    ).length;
    const failedCount = results.filter(
      (result) => result.status === "FAILED"
    ).length;
    const skippedCount =
      walletPublicKeys.length - submittedCount - failedCount;
    await Promise.all(
      results.map(async (result) => {
        await testRunLogService.appendServerEvent({
          eventType: "wallet_transaction",
          source: "wallet.service",
          tokenPublicKey,
          action: "wallet.sendSolFromMainWallet",
          userId,
          wallets: [mainWallet.publicKey, result.publicKey],
          signature: result.signature ?? undefined,
          status: result.status,
          expectedValue: {
            amountSol,
          },
          actualValue: result,
        });
      })
    );

    return {
      submittedCount,
      failedCount,
      skippedCount,
      results,
    };
    });
  },

  async returnSolToMainWallet(
    tokenPublicKey: string,
    userId: string,
    walletPublicKeys: string[],
    amountSol?: number,
    useMax?: boolean,
    source?: AppTransactionSource
  ): Promise<WalletTransferResult> {
    const actionKey = `wallet:return-sol:${userId}:${tokenPublicKey}`;
    return await withActionLock(actionKey, async () => {
    const token = await prisma.token.findFirst({
      where: { publicKey: tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const [user, operationalWallets, devWallet] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          mainWallet: { select: { publicKey: true, privateKey: true } },
        },
      }),
      prisma.wallet.findMany({
        where: {
          tokenPublicKey,
          type: { in: OPERATIONAL_WALLET_TYPES },
        },
        select: { publicKey: true, privateKey: true, type: true },
      }),
      prisma.tokenDevWallet.findFirst({
        where: { tokenPublicKey },
        select: {
          wallet: { select: { publicKey: true, privateKey: true, type: true, isSystemWallet: true } },
        },
      }),
    ]);

    const mainWallet = user?.mainWallet;
    if (!mainWallet) {
      throw new AppError("Main wallet not found", 400);
    }

    const mainPublicKey = new PublicKey(mainWallet.publicKey);
    const devWalletTarget =
      devWallet?.wallet &&
      devWallet.wallet.publicKey !== mainWallet.publicKey &&
      !devWallet.wallet.isSystemWallet
        ? devWallet.wallet
        : null;
    const allowedWallets = new Map(
      [...operationalWallets, ...(devWalletTarget ? [devWalletTarget] : [])].map(
        (wallet) => [wallet.publicKey, wallet]
      )
    );

    const targets = Array.from(new Set(walletPublicKeys))
      .filter((publicKey) => publicKey !== mainWallet.publicKey)
      .map((publicKey) => allowedWallets.get(publicKey))
      .filter((wallet): wallet is NonNullable<typeof wallet> =>
        Boolean(wallet)
      );

    if (targets.length === 0) {
      throw new AppError("No valid target wallets provided", 400);
    }

    const connection = getSolanaConnection();
    const mainKeypair =
      useMax && mainWallet.privateKey
        ? Keypair.fromSecretKey(bs58.decode(mainWallet.privateKey))
        : null;
    const walletBalances = new Map<string, number>();
    let reclaimMode: "main-sponsored" | "source-funded" = "source-funded";
    let sponsoredFeeLamports = 0;
    if (useMax && mainKeypair) {
      await mapWithConcurrency(
        targets,
        rpcConfig.tuning.transferConcurrency,
        async (wallet) => {
          const sender = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
          const balanceLamports = await retryRpcWithTimeout(
            () => connection.getBalance(sender.publicKey),
            rpcConfig.tuning.rpcTimeoutMs
          );
          walletBalances.set(wallet.publicKey, balanceLamports);
        }
      );

      const firstRecoverableTarget = targets.find(
        (wallet) => (walletBalances.get(wallet.publicKey) ?? 0) > 0
      );
      if (firstRecoverableTarget) {
        const sender = Keypair.fromSecretKey(
          bs58.decode(firstRecoverableTarget.privateKey)
        );
        const { blockhash } = await retryRpcWithTimeout(
          () => connection.getLatestBlockhash("confirmed"),
          rpcConfig.tuning.rpcTimeoutMs
        );
        const sponsoredFeeTransaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: sender.publicKey,
            toPubkey: mainPublicKey,
            lamports: 1,
          })
        );
        sponsoredFeeTransaction.recentBlockhash = blockhash;
        sponsoredFeeTransaction.feePayer = mainKeypair.publicKey;
        const sponsoredFee = await retryRpcWithTimeout(
          () =>
            connection.getFeeForMessage(
              sponsoredFeeTransaction.compileMessage(),
              "confirmed"
            ),
          rpcConfig.tuning.rpcTimeoutMs
        );
        sponsoredFeeLamports = sponsoredFee.value ?? 5000;
      }

      const mainWalletBalanceLamports = await retryRpcWithTimeout(
        () => connection.getBalance(mainKeypair.publicKey),
        rpcConfig.tuning.rpcTimeoutMs
      );
      reclaimMode = resolveBatchReclaimMode({
        mainWalletBalanceLamports,
        walletBalancesLamports: targets.map(
          (wallet) => walletBalances.get(wallet.publicKey) ?? 0
        ),
        sponsoredFeeLamports,
      });
    }
    const transferConcurrency = rpcConfig.tuning.transferConcurrency;
    const results = await mapWithConcurrency(
      targets,
      transferConcurrency,
      async (wallet) => {
        const sender = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
        const senderPk = wallet.publicKey;
        const mainPk = mainWallet.publicKey;
        const isSelf = senderPk === mainPk;
        const intentSol = amountSol ?? 0;
        const trackRows: { id: string; walletPublicKey: string }[] = [];
        const senderId = await appTransactionService
          .create({
            userId,
            type: "TRANSFER_RETURN",
            source: source ?? "WALLET",
            tokenPublicKey,
            walletPublicKey: senderPk,
            fromAddress: senderPk,
            toAddress: mainPk,
            intentSolAmount: isSelf ? 0 : -intentSol,
          })
          .then((r) => r.id)
          .catch(() => null);
        if (senderId) trackRows.push({ id: senderId, walletPublicKey: senderPk });
        if (!isSelf) {
          const receiverId = await appTransactionService
            .create({
              userId,
              type: "TRANSFER_RETURN",
              source: source ?? "WALLET",
              tokenPublicKey,
              walletPublicKey: mainPk,
              fromAddress: senderPk,
              toAddress: mainPk,
              intentSolAmount: intentSol,
            })
            .then((r) => r.id)
            .catch(() => null);
          if (receiverId) trackRows.push({ id: receiverId, walletPublicKey: mainPk });
        }

        const computeLamports = async (blockhash: string) => {
          if (useMax) {
            const balanceLamports =
              walletBalances.get(wallet.publicKey) ??
              (await retryRpcWithTimeout(
                () => connection.getBalance(sender.publicKey),
                rpcConfig.tuning.rpcTimeoutMs
              ));
            if (reclaimMode === "main-sponsored") {
              return computeSponsoredRecoverableLamports({
                balanceLamports,
                feeLamports: sponsoredFeeLamports,
              });
            }
            const feeTransaction = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: sender.publicKey,
                toPubkey: mainPublicKey,
                lamports: 1,
              })
            );
            feeTransaction.recentBlockhash = blockhash;
            feeTransaction.feePayer = sender.publicKey;
            const fee = await retryRpcWithTimeout(
              () =>
                connection.getFeeForMessage(
                  feeTransaction.compileMessage(),
                  "confirmed"
                ),
              rpcConfig.tuning.rpcTimeoutMs
            );
            const feeLamports = fee.value ?? 5000;
            const lamports = balanceLamports - feeLamports;
            return lamports > 0 ? lamports : 0;
          }
          if (!amountSol) {
            throw new AppError("Amount in SOL is required", 400);
          }
          return Math.floor(amountSol * 1_000_000_000);
        };

        const sendTransfer = async () => {
          const { blockhash } =
            await retryRpcWithTimeout(
              () => connection.getLatestBlockhash("confirmed"),
              rpcConfig.tuning.rpcTimeoutMs
            );
          const lamports = await computeLamports(blockhash);
          if (lamports <= 0) {
            return null;
          }
          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: sender.publicKey,
              toPubkey: mainPublicKey,
              lamports,
            })
          );
          transaction.recentBlockhash = blockhash;
          transaction.feePayer =
            useMax && reclaimMode === "main-sponsored" && mainKeypair
              ? mainKeypair.publicKey
              : sender.publicKey;
          return await retryRpcWithTimeout(
            () =>
              sendAndConfirmTransaction(
                connection,
                transaction,
                useMax && reclaimMode === "main-sponsored" && mainKeypair
                  ? [mainKeypair, sender]
                  : [sender],
                {
                  commitment: "confirmed",
                }
              ),
            rpcConfig.tuning.confirmTimeoutMs
          );
        };

        const trackIds = trackRows.map((r) => r.id);
        const settleAfterConfirm = async (signature: string) => {
          if (trackIds.length > 0) {
            await appTransactionService
              .confirmMany(trackIds, { signature })
              .catch(() => {});
            await settleSignature({ signature, rows: trackRows, connection }).catch(() => {});
          }
        };
        const failAllTracked = async (message: string) => {
          if (trackIds.length > 0) {
            await appTransactionService
              .failMany(trackIds, { errorMessage: message })
              .catch(() => {});
          }
        };
        try {
          const signature = await sendTransfer();
          if (!signature) {
            await failAllTracked("Zero balance");
            return {
              publicKey: wallet.publicKey,
              status: "SKIPPED" as const,
              signature: null,
            };
          }
          await settleAfterConfirm(signature);
          return {
            publicKey: wallet.publicKey,
            status: "SUBMITTED" as const,
            signature,
          };
        } catch (error) {
          if (error instanceof TransactionExpiredBlockheightExceededError) {
            try {
              const signature = await sendTransfer();
              if (!signature) {
                await failAllTracked("Zero balance");
                return {
                  publicKey: wallet.publicKey,
                  status: "SKIPPED" as const,
                  signature: null,
                };
              }
              await settleAfterConfirm(signature);
              return {
                publicKey: wallet.publicKey,
                status: "SUBMITTED" as const,
                signature,
              };
            } catch (retryError) {
              const message =
                retryError instanceof Error
                  ? retryError.message
                  : String(retryError);
              log.error("Retry transfer failed", { errorMessage: message });
              await failAllTracked(message);
              return {
                publicKey: wallet.publicKey,
                status: "FAILED" as const,
                signature: null,
                error: message,
              };
            }
          }
          const message =
            error instanceof Error ? error.message : String(error);
          log.error("Transfer failed", { errorMessage: message });
          await failAllTracked(message);
          return {
            publicKey: wallet.publicKey,
            status: "FAILED" as const,
            signature: null,
            error: message,
          };
        }
      }
    );

    const successfulTargets = results
      .filter((result) => result.status === "SUBMITTED")
      .map((result) => result.publicKey);
    const refreshWalletPublicKeys = Array.from(
      new Set([mainWallet.publicKey, ...successfulTargets])
    );
    if (refreshWalletPublicKeys.length > 0) {
      try {
        await walletService.refreshWalletBalances(
          tokenPublicKey,
          userId,
          refreshWalletPublicKeys,
          true,
          "wallet.returnSolToMainWallet"
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn("Post-return balance refresh failed", { errorMessage: message });
      }
    }

    const submittedCount = results.filter(
      (result) => result.status === "SUBMITTED"
    ).length;
    const failedCount = results.filter(
      (result) => result.status === "FAILED"
    ).length;
    const skippedCount = results.filter(
      (result) => result.status === "SKIPPED"
    ).length;
    await Promise.all(
      results.map(async (result) => {
        await testRunLogService.appendServerEvent({
          eventType: "wallet_transaction",
          source: "wallet.service",
          tokenPublicKey,
          action: "wallet.returnSolToMainWallet",
          userId,
          wallets: [result.publicKey, mainWallet.publicKey],
          signature: result.signature ?? undefined,
          status: result.status,
          expectedValue: {
            amountSol: amountSol ?? null,
            useMax: Boolean(useMax),
          },
          actualValue: result,
        });
      })
    );

    return {
      submittedCount,
      failedCount,
      skippedCount,
      results,
    };
    });
  },
};

export type WalletsByTokenOutput = Awaited<
  ReturnType<typeof walletService.getOperationalWalletsByToken>
>;

export type WalletItem = WalletsByTokenOutput["wallets"][number];
