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
import { getSolanaConnection } from "@/lib/solana/connection";
import { AppError } from "@/server/errors";
import { rpcConfig } from "@/lib/config/rpc.config";
import { cacheConfig } from "@/lib/config/cache.config";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { retryRpc } from "@/lib/utils/rpc-retry";
import { mapWithConcurrency } from "@/lib/utils/async";
import type { WalletTransferResult } from "@/server/schemas/wallet.schema";

export const walletService = {
  async getOperationalWalletsByToken(tokenPublicKey: string, userId: string) {
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

    const wallets = await prisma.wallet.findMany({
      where: {
        tokenPublicKey,
        type: { in: ["BUNDLER", "VOLUME", "DISTRIBUTION"] },
      },
      select: {
        publicKey: true,
        type: true,
        balanceSol: true,
        balanceRefreshedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      token: {
        publicKey: token.publicKey,
        name: token.name,
        symbol: token.symbol,
        imageUrl: token.imageUrl,
      },
      wallets,
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

  async getWalletByToken(
    tokenPublicKey: string,
    walletPublicKey: string,
    userId: string
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
      },
      mainWallet,
    };
  },
  async getWalletPrivateKey(
    tokenPublicKey: string,
    walletPublicKey: string,
    userId: string
  ) {
    const token = await prisma.token.findFirst({
      where: { publicKey: tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

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

    if (!wallet.privateKey) {
      throw new AppError("Private key not available", 404);
    }

    return { privateKey: wallet.privateKey };
  },

  async refreshWalletBalances(
    tokenPublicKey: string,
    userId: string,
    walletPublicKeys?: string[],
    force = false
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
          type: { in: ["BUNDLER", "VOLUME", "DISTRIBUTION"] },
        },
        select: { publicKey: true, balanceRefreshedAt: true },
      }),
      prisma.tokenDevWallet.findFirst({
        where: { tokenPublicKey },
        select: {
          wallet: { select: { publicKey: true, balanceRefreshedAt: true } },
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          mainWallet: { select: { publicKey: true, balanceRefreshedAt: true } },
        },
      }),
    ]);

    const availableWallets = [
      ...(user?.mainWallet ? [user.mainWallet] : []),
      ...(devWallet?.wallet ? [devWallet.wallet] : []),
      ...operationalWallets,
    ];

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
          .filter(
            (
              wallet
            ): wallet is {
              publicKey: string;
              balanceRefreshedAt: Date | null;
            } => !!wallet
          )
      : availableWallets;

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
    amountSol: number
  ): Promise<WalletTransferResult> {
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
          type: { in: ["BUNDLER", "VOLUME", "DISTRIBUTION"] },
        },
        select: { publicKey: true },
      }),
      prisma.tokenDevWallet.findFirst({
        where: { tokenPublicKey },
        select: { wallet: { select: { publicKey: true } } },
      }),
    ]);

    const mainWallet = user?.mainWallet;
    if (!mainWallet) {
      throw new AppError("Main wallet not found", 400);
    }

    const allowedWallets = new Set([
      ...operationalWallets.map((wallet) => wallet.publicKey),
      ...(devWallet?.wallet ? [devWallet.wallet.publicKey] : []),
    ]);
    const targets = walletPublicKeys.filter((publicKey) =>
      allowedWallets.has(publicKey)
    );

    if (targets.length === 0) {
      throw new AppError("No valid target wallets provided", 400);
    }

    const connection = getSolanaConnection();
    const sender = Keypair.fromSecretKey(bs58.decode(mainWallet.privateKey));
    const lamports = Math.floor(amountSol * 1_000_000_000);

    const transferConcurrency = 5;
    const results = await mapWithConcurrency(
      targets,
      transferConcurrency,
      async (publicKey) => {
        try {
          const destination = new PublicKey(publicKey);
          const sendTransfer = async () => {
            const { blockhash, lastValidBlockHeight } =
              await connection.getLatestBlockhash("confirmed");
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
            return await sendAndConfirmTransaction(
              connection,
              transaction,
              [sender],
              {
                commitment: "confirmed",
              }
            );
          };

          try {
            const signature = await sendTransfer();
            return {
              publicKey,
              status: "SUBMITTED" as const,
              signature,
            };
          } catch (error) {
            if (error instanceof TransactionExpiredBlockheightExceededError) {
              try {
                const signature = await sendTransfer();
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
                console.error("[WalletService] Retry transfer failed", message);
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
            console.error("[WalletService] Transfer failed", message);
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
        true
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[WalletService] Post-send balance refresh failed: ${message}`
      );
    }

    const submittedCount = results.filter(
      (result) => result.status === "SUBMITTED"
    ).length;
    const failedCount = results.filter(
      (result) => result.status === "FAILED"
    ).length;
    const skippedCount =
      walletPublicKeys.length - submittedCount - failedCount;

    return {
      submittedCount,
      failedCount,
      skippedCount,
      results,
    };
  },

  async returnSolToMainWallet(
    tokenPublicKey: string,
    userId: string,
    walletPublicKeys: string[],
    amountSol?: number,
    useMax?: boolean
  ): Promise<WalletTransferResult> {
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
        select: { mainWallet: { select: { publicKey: true } } },
      }),
      prisma.wallet.findMany({
        where: {
          tokenPublicKey,
          type: { in: ["BUNDLER", "VOLUME", "DISTRIBUTION"] },
        },
        select: { publicKey: true, privateKey: true, type: true },
      }),
      prisma.tokenDevWallet.findFirst({
        where: { tokenPublicKey },
        select: {
          wallet: { select: { publicKey: true, privateKey: true, type: true } },
        },
      }),
    ]);

    const mainWallet = user?.mainWallet;
    if (!mainWallet) {
      throw new AppError("Main wallet not found", 400);
    }

    const mainPublicKey = new PublicKey(mainWallet.publicKey);
    const allowedWallets = new Map(
      [
        ...operationalWallets,
        ...(devWallet?.wallet ? [devWallet.wallet] : []),
      ].map((wallet) => [wallet.publicKey, wallet])
    );

    const targets = walletPublicKeys
      .map((publicKey) => allowedWallets.get(publicKey))
      .filter((wallet): wallet is NonNullable<typeof wallet> =>
        Boolean(wallet)
      );

    if (targets.length === 0) {
      throw new AppError("No valid target wallets provided", 400);
    }

    const connection = getSolanaConnection();
    const transferConcurrency = 5;
    const results = await mapWithConcurrency(
      targets,
      transferConcurrency,
      async (wallet) => {
        const sender = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));

        const computeLamports = async (blockhash: string) => {
          if (useMax) {
            const balanceLamports = await connection.getBalance(
              sender.publicKey
            );
            const feeTransaction = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: sender.publicKey,
                toPubkey: mainPublicKey,
                lamports: 1,
              })
            );
            feeTransaction.recentBlockhash = blockhash;
            feeTransaction.feePayer = sender.publicKey;
            const fee = await connection.getFeeForMessage(
              feeTransaction.compileMessage(),
              "confirmed"
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
            await connection.getLatestBlockhash("confirmed");
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
          transaction.feePayer = sender.publicKey;
          return await sendAndConfirmTransaction(
            connection,
            transaction,
            [sender],
            { commitment: "confirmed" }
          );
        };

        try {
          const signature = await sendTransfer();
          if (!signature) {
            return {
              publicKey: wallet.publicKey,
              status: "SKIPPED" as const,
              signature: null,
            };
          }
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
                return {
                  publicKey: wallet.publicKey,
                  status: "SKIPPED" as const,
                  signature: null,
                };
              }
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
              console.error("[WalletService] Retry transfer failed", message);
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
          console.error("[WalletService] Transfer failed", message);
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
          true
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[WalletService] Post-return balance refresh failed: ${message}`
        );
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

    return {
      submittedCount,
      failedCount,
      skippedCount,
      results,
    };
  },
};

export type WalletsByTokenOutput = Awaited<
  ReturnType<typeof walletService.getOperationalWalletsByToken>
>;

export type WalletItem = WalletsByTokenOutput["wallets"][number];
