import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import { getSolanaConnection } from "@/lib/solana/connection";
import { PublicKey } from "@solana/web3.js";
import { type WalletType } from "@/lib/generated/prisma/enums";
import type {
  ListHoldingsByTokenInput,
  RefreshHoldingsByTokenInput,
} from "@/server/schemas/holding.schema";

type WalletRecord = {
  publicKey: string;
  type: WalletType;
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

    const balanceResults = await Promise.all(
      wallets.map(async (wallet) => {
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
      })
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

    return refreshed;
  },
};

export type HoldingItem = Awaited<
  ReturnType<typeof holdingService.listByToken>
>[number];
