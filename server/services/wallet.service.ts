import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { prisma } from "@/lib/prisma";
import { getSolanaConnection } from "@/lib/solana/connection";
import { AppError } from "@/server/errors";
import { rpcConfig } from "@/lib/config/rpc.config";
import { cacheConfig } from "@/lib/config/cache.config";
import { refreshCacheService } from "@/server/services/refresh-cache.service";

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
    const walletPublicKey = new PublicKey(mainWallet.publicKey);
    const solBalance = await connection.getBalance(walletPublicKey);
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

  async refreshWalletBalances(
    tokenPublicKey: string,
    userId: string,
    walletPublicKeys?: string[]
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
    const requestedWallets = walletPublicKeys?.length
      ? walletPublicKeys
          .map((key) => allowedWallets.get(key))
          .filter(
            (
              wallet
            ): wallet is { publicKey: string; balanceRefreshedAt: Date | null } =>
              !!wallet
          )
      : availableWallets;

    const now = new Date();
    const cooldownMs = cacheConfig.cooldownMs.walletBalances;
    const targetWallets = requestedWallets.filter((wallet) => {
      if (!wallet.balanceRefreshedAt) return true;
      return now.getTime() - wallet.balanceRefreshedAt.getTime() >= cooldownMs;
    });

    if (targetWallets.length === 0) {
      return [];
    }

    const connection = getSolanaConnection();
    const solBalanceMap = new Map<string, number>();
    const validWallets: { wallet: typeof targetWallets[number]; key: PublicKey }[] =
      [];
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
      const infos = await connection.getMultipleAccountsInfo(
        batch.map((item) => item.key),
        "confirmed"
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

    await prisma.$transaction(
      balances.map((balance) =>
        prisma.wallet.update({
          where: { publicKey: balance.publicKey },
          data: {
            balanceSol: balance.balanceSol,
            balanceRefreshedAt: now,
          },
        })
      )
    );

    await refreshCacheService.touch({
      userId,
      tokenPublicKey: token.publicKey,
      scope: "WALLETS",
      refreshedAt: now,
    });

    return balances.map((balance) => ({
      publicKey: balance.publicKey,
      balanceSol: balance.balanceSol,
      balanceRefreshedAt: now,
    }));
  },

  async sendSolFromMainWallet(
    tokenPublicKey: string,
    userId: string,
    walletPublicKeys: string[],
    amountSol: number
  ) {
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
        select: { mainWallet: { select: { publicKey: true, privateKey: true } } },
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
    const targets = walletPublicKeys.filter(
      (publicKey) => allowedWallets.has(publicKey)
    );

    if (targets.length === 0) {
      throw new AppError("No valid target wallets provided", 400);
    }

    const connection = getSolanaConnection();
    const sender = Keypair.fromSecretKey(bs58.decode(mainWallet.privateKey));
    const lamports = Math.floor(amountSol * 1_000_000_000);

    const results = await Promise.all(
      targets.map(async (publicKey) => {
        const destination = new PublicKey(publicKey);
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: sender.publicKey,
            toPubkey: destination,
            lamports,
          })
        );
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [sender],
          { commitment: "confirmed" }
        );
        return { publicKey, signature };
      })
    );

    return results;
  },

  async returnSolToMainWallet(
    tokenPublicKey: string,
    userId: string,
    walletPublicKeys: string[],
    amountSol?: number,
    useMax?: boolean
  ) {
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
        select: { wallet: { select: { publicKey: true, privateKey: true, type: true } } },
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
      .filter((wallet): wallet is NonNullable<typeof wallet> => Boolean(wallet));

    if (targets.length === 0) {
      throw new AppError("No valid target wallets provided", 400);
    }

    const connection = getSolanaConnection();
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");

    const results = await Promise.all(
      targets.map(async (wallet) => {
        const sender = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
        let lamports: number;

        if (useMax) {
          const balanceLamports = await connection.getBalance(sender.publicKey);
          const feeTransaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: sender.publicKey,
              toPubkey: mainPublicKey,
              lamports: 1,
            })
          );
          feeTransaction.recentBlockhash = latestBlockhash.blockhash;
          feeTransaction.feePayer = sender.publicKey;
          const fee = await connection.getFeeForMessage(
            feeTransaction.compileMessage(),
            "confirmed"
          );
          const feeLamports = fee.value ?? 5000;
          lamports = balanceLamports - feeLamports;
          if (lamports <= 0) {
            return { publicKey: wallet.publicKey, signature: null };
          }
        } else {
          if (!amountSol) {
            throw new AppError("Amount in SOL is required", 400);
          }
          lamports = Math.floor(amountSol * 1_000_000_000);
        }

        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: sender.publicKey,
            toPubkey: mainPublicKey,
            lamports,
          })
        );
        transaction.recentBlockhash = latestBlockhash.blockhash;
        transaction.feePayer = sender.publicKey;
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [sender],
          { commitment: "confirmed" }
        );
        return { publicKey: wallet.publicKey, signature };
      })
    );

    return results;
  },
};

export type WalletsByTokenOutput = Awaited<
  ReturnType<typeof walletService.getOperationalWalletsByToken>
>;

export type WalletItem = WalletsByTokenOutput["wallets"][number];
