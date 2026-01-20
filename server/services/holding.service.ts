import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import { getSolanaConnection } from "@/lib/solana/connection";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  type Connection,
} from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";
import { type WalletType } from "@/lib/generated/prisma/enums";
import { rpcConfig } from "@/lib/config/rpc.config";
import { mapWithConcurrency } from "@/lib/utils/async";
import { sellTokensWithNewIdl } from "@/server/solana/pump-new-idl";
import { getPumpProgram } from "@/server/solana/pump-idl";
import type {
  ListHoldingsByTokenInput,
  RefreshHoldingsByTokenInput,
  SellHoldingsByTokenInput,
} from "@/server/schemas/holding.schema";

type WalletRecord = {
  publicKey: string;
  type: WalletType;
};

type WalletWithKey = WalletRecord & {
  privateKey: string;
};

async function getAllowedWallets(
  tokenPublicKey: string,
  userId: string,
  walletPublicKeys?: string[]
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

  const [operationalWallets, devWallet, user] = await Promise.all([
    prisma.wallet.findMany({
      where: {
        tokenPublicKey,
        type: { in: ["BUNDLER", "VOLUME", "DISTRIBUTION"] },
      },
      select: { publicKey: true, type: true },
    }),
    prisma.tokenDevWallet.findFirst({
      where: { tokenPublicKey },
      select: { wallet: { select: { publicKey: true, type: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { mainWallet: { select: { publicKey: true, type: true } } },
    }),
  ]);

  const allWallets: WalletRecord[] = [
    ...(user?.mainWallet ? [user.mainWallet] : []),
    ...(devWallet?.wallet ? [devWallet.wallet] : []),
    ...operationalWallets,
  ];

  const filteredWallets = walletPublicKeys?.length
    ? allWallets.filter((wallet) => walletPublicKeys.includes(wallet.publicKey))
    : allWallets;

  return { token, wallets: filteredWallets };
}

async function getAllowedWalletsWithKeys(
  tokenPublicKey: string,
  userId: string,
  walletPublicKeys?: string[]
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

  const [operationalWallets, devWallet, user] = await Promise.all([
    prisma.wallet.findMany({
      where: {
        tokenPublicKey,
        type: { in: ["BUNDLER", "VOLUME", "DISTRIBUTION"] },
      },
      select: { publicKey: true, type: true, privateKey: true },
    }),
    prisma.tokenDevWallet.findFirst({
      where: { tokenPublicKey },
      select: { wallet: { select: { publicKey: true, type: true, privateKey: true } } },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { mainWallet: { select: { publicKey: true, type: true, privateKey: true } } },
    }),
  ]);

  const allWallets: WalletWithKey[] = [
    ...(user?.mainWallet ? [user.mainWallet] : []),
    ...(devWallet?.wallet ? [devWallet.wallet] : []),
    ...operationalWallets,
  ];

  const walletMap = new Map<string, WalletWithKey>();
  allWallets.forEach((wallet) => {
    if (wallet.privateKey) {
      walletMap.set(wallet.publicKey, wallet);
    }
  });

  const filteredWallets = walletPublicKeys?.length
    ? walletPublicKeys
        .map((publicKey) => walletMap.get(publicKey))
        .filter((wallet): wallet is WalletWithKey => Boolean(wallet))
    : Array.from(walletMap.values());

  return { token, wallets: filteredWallets };
}

async function getTokenBalanceForWallet(
  connection: Connection,
  walletPublicKey: string,
  mintPublicKey: PublicKey
) {
  try {
    const owner = new PublicKey(walletPublicKey);
    const ata = await getAssociatedTokenAddress(mintPublicKey, owner);
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Account does not exist") ||
        error.message.includes("could not find account") ||
        error.name === "TokenAccountNotFoundError")
    ) {
      return BigInt(0);
    }
    throw error;
  }
}

export const holdingService = {
  async listByToken(input: ListHoldingsByTokenInput, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey: input.tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    return await prisma.holding.findMany({
      where: {
        tokenPublicKey: input.tokenPublicKey,
        ...(input.walletPublicKey
          ? { walletPublicKey: input.walletPublicKey }
          : {}),
      },
      include: {
        wallet: {
          select: { publicKey: true, type: true },
        },
      },
      orderBy: { lastUpdated: "desc" },
    });
  },

  async refreshByToken(input: RefreshHoldingsByTokenInput, userId: string) {
    const { token, wallets } = await getAllowedWallets(
      input.tokenPublicKey,
      userId,
      input.walletPublicKeys
    );

    const connection = getSolanaConnection();
    const mintPublicKey = new PublicKey(token.publicKey);
    const mintInfo = await connection.getParsedAccountInfo(mintPublicKey);
    const mintDecimals =
      (mintInfo.value?.data as { parsed?: { info?: { decimals?: number } } })
        ?.parsed?.info?.decimals ?? 9;

    const balanceResults = await mapWithConcurrency(
      wallets,
      rpcConfig.tuning.holdingBalanceConcurrency,
      async (wallet) => {
        const ownerPublicKey = new PublicKey(wallet.publicKey);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          ownerPublicKey,
          { mint: mintPublicKey }
        );
        const tokenBalance = tokenAccounts.value.reduce((total, account) => {
          const amount =
            account.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0;
          return total + amount;
        }, 0);

        return { wallet, tokenBalance };
      }
    );

    const now = new Date();
    const updateResults = await Promise.all(
      balanceResults.map(async ({ wallet, tokenBalance }) => {
        const [buyAgg, sellAgg, lastTx] = await Promise.all([
          prisma.transaction.aggregate({
            where: {
              walletPublicKey: wallet.publicKey,
              tokenPublicKey: token.publicKey,
              transactionType: "BUY",
            },
            _sum: { solAmount: true, tokenAmount: true },
          }),
          prisma.transaction.aggregate({
            where: {
              walletPublicKey: wallet.publicKey,
              tokenPublicKey: token.publicKey,
              transactionType: "SELL",
            },
            _sum: { solAmount: true, tokenAmount: true },
          }),
          prisma.transaction.findFirst({
            where: {
              walletPublicKey: wallet.publicKey,
              tokenPublicKey: token.publicKey,
            },
            orderBy: { createdAt: "desc" },
            select: { transactionSignature: true },
          }),
        ]);

        const totalBuyAmount = Number(buyAgg._sum.solAmount ?? 0);
        const totalSellAmount = Number(sellAgg._sum.solAmount ?? 0);
        const totalBuyTokens = Number(buyAgg._sum.tokenAmount ?? 0);
        const averageBuyPrice =
          totalBuyTokens > 0 ? totalBuyAmount / totalBuyTokens : 0;

        if (tokenBalance > 0) {
          const existing = await prisma.holding.findFirst({
            where: {
              walletPublicKey: wallet.publicKey,
              tokenPublicKey: token.publicKey,
            },
            select: { id: true },
          });

          if (existing) {
            return prisma.holding.update({
              where: { id: existing.id },
              data: {
                tokenBalance,
                totalBuyAmount,
                totalSellAmount,
                averageBuyPrice,
                lastTransactionSignature:
                  lastTx?.transactionSignature ?? "",
                lastUpdated: now,
                mintAddress: token.publicKey,
                tokenName: token.name,
                tokenSymbol: token.symbol,
                tokenImageUrl: token.imageUrl ?? "",
                tokenDecimals: mintDecimals,
              },
            });
          }

          return prisma.holding.create({
            data: {
              walletPublicKey: wallet.publicKey,
              tokenPublicKey: token.publicKey,
              tokenBalance,
              totalBuyAmount,
              totalSellAmount,
              averageBuyPrice,
              lastTransactionSignature: lastTx?.transactionSignature ?? "",
              lastUpdated: now,
              mintAddress: token.publicKey,
              tokenName: token.name,
              tokenSymbol: token.symbol,
              tokenImageUrl: token.imageUrl ?? "",
              tokenDecimals: mintDecimals,
            },
          });
        }

        await prisma.holding.deleteMany({
          where: {
            walletPublicKey: wallet.publicKey,
            tokenPublicKey: token.publicKey,
          },
        });

        return null;
      })
    );

    const refreshed = updateResults.filter(Boolean);

    await refreshCacheService.touch({
      userId,
      tokenPublicKey: token.publicKey,
      scope: "HOLDINGS",
    });

    return refreshed;
  },

  async sellByToken(input: SellHoldingsByTokenInput, userId: string) {
    const { token, wallets } = await getAllowedWalletsWithKeys(
      input.tokenPublicKey,
      userId,
      input.walletPublicKeys
    );

    if (wallets.length === 0) {
      throw new AppError("No valid wallets selected", 400);
    }

    const connection = getSolanaConnection();
    const mintPublicKey = new PublicKey(token.publicKey);
    const sellPercentage = Math.floor(input.sellPercentage);

    const results = await Promise.all(
      wallets.map(async (wallet) => {
        try {
          const balance = await getTokenBalanceForWallet(
            connection,
            wallet.publicKey,
            mintPublicKey
          );
          if (balance <= BigInt(0)) {
            return {
              walletPublicKey: wallet.publicKey,
              status: "SKIPPED",
              error: "No balance",
            };
          }

          const sellAmount = (balance * BigInt(sellPercentage)) / BigInt(100);
          if (sellAmount <= BigInt(0)) {
            return {
              walletPublicKey: wallet.publicKey,
              status: "SKIPPED",
              error: "Sell amount too small",
            };
          }

          const seller = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
          const provider = new AnchorProvider(
            connection,
            new NodeWallet(seller),
            { commitment: "finalized" }
          );
          const program = getPumpProgram(provider);
          const tx = await sellTokensWithNewIdl(
            program,
            seller,
            mintPublicKey,
            new BN(sellAmount.toString()),
            new BN(0)
          );
          tx.feePayer = seller.publicKey;
          const signature = await sendAndConfirmTransaction(
            connection,
            tx,
            [seller],
            { commitment: "confirmed" }
          );

          return {
            walletPublicKey: wallet.publicKey,
            status: "SUBMITTED",
            signature,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            walletPublicKey: wallet.publicKey,
            status: "FAILED",
            error: message,
          };
        }
      })
    );

    const submitted = results.filter((result) => result.status === "SUBMITTED");
    const failed = results.filter((result) => result.status === "FAILED");

    return {
      tokenPublicKey: token.publicKey,
      submitted: submitted.length,
      failed: failed.length,
      results,
    };
  },
};

export type HoldingItem = Awaited<
  ReturnType<typeof holdingService.listByToken>
>[number];
