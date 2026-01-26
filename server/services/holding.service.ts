import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import { getSolanaConnection } from "@/lib/solana/connection";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  type Connection,
} from "@solana/web3.js";
import {
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
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
      select: {
        wallet: { select: { publicKey: true, type: true, privateKey: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        mainWallet: {
          select: { publicKey: true, type: true, privateKey: true },
        },
      },
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

    const atas = await Promise.all(
      wallets.map(async (wallet) => ({
        wallet,
        ata: await getAssociatedTokenAddress(
          mintPublicKey,
          new PublicKey(wallet.publicKey)
        ),
      }))
    );

    type ParsedAccountInfoItem = Awaited<
      ReturnType<Connection["getMultipleParsedAccounts"]>
    >["value"][number];
    const ataAddresses = atas.map((a) => a.ata);
    const accountInfos: ParsedAccountInfoItem[] = [];
    for (let i = 0; i < ataAddresses.length; i += 100) {
      const batch = ataAddresses.slice(i, i + 100);
      const batchInfos = await connection.getMultipleParsedAccounts(batch);
      accountInfos.push(...batchInfos.value);
    }

    const balanceResults = atas.map(({ wallet, ata }, index) => {
      const accountInfo = accountInfos[index];
      const ataExists = Boolean(accountInfo?.data);
      let tokenBalance = 0;
      if (accountInfo?.data && "parsed" in accountInfo.data) {
        const parsed = accountInfo.data.parsed as {
          info?: { tokenAmount?: { uiAmount?: number } };
        };
        tokenBalance = parsed?.info?.tokenAmount?.uiAmount ?? 0;
      }
      return { wallet, tokenBalance, ataExists };
    });

    const walletPublicKeys = balanceResults.map((r) => r.wallet.publicKey);

    const [transactionAggregates, lastTransactions, existingHoldings] =
      await Promise.all([
        prisma.transaction.groupBy({
          by: ["walletPublicKey", "transactionType"],
          where: {
            walletPublicKey: { in: walletPublicKeys },
            tokenPublicKey: token.publicKey,
          },
          _sum: { solAmount: true, tokenAmount: true },
        }),
        prisma.$queryRaw<
          Array<{ walletPublicKey: string; transactionSignature: string }>
        >`
          SELECT DISTINCT ON ("walletPublicKey") 
            "walletPublicKey", 
            "transactionSignature"
          FROM "Transaction"
          WHERE "walletPublicKey" = ANY(${walletPublicKeys})
            AND "tokenPublicKey" = ${token.publicKey}
          ORDER BY "walletPublicKey", "createdAt" DESC
        `,
        prisma.holding.findMany({
          where: {
            walletPublicKey: { in: walletPublicKeys },
            tokenPublicKey: token.publicKey,
          },
          select: { id: true, walletPublicKey: true },
        }),
      ]);

    const aggregateMap = new Map<
      string,
      { buy: { sol: number; tokens: number }; sell: { sol: number } }
    >();
    for (const agg of transactionAggregates) {
      const existing = aggregateMap.get(agg.walletPublicKey) ?? {
        buy: { sol: 0, tokens: 0 },
        sell: { sol: 0 },
      };
      if (agg.transactionType === "BUY") {
        existing.buy.sol = Number(agg._sum.solAmount ?? 0);
        existing.buy.tokens = Number(agg._sum.tokenAmount ?? 0);
      } else if (agg.transactionType === "SELL") {
        existing.sell.sol = Number(agg._sum.solAmount ?? 0);
      }
      aggregateMap.set(agg.walletPublicKey, existing);
    }

    const lastTxMap = new Map<string, string>();
    for (const tx of lastTransactions) {
      lastTxMap.set(tx.walletPublicKey, tx.transactionSignature);
    }

    const existingHoldingMap = new Map<string, string>();
    for (const holding of existingHoldings) {
      existingHoldingMap.set(holding.walletPublicKey, holding.id);
    }

    const now = new Date();
    const updateResults = await Promise.all(
      balanceResults.map(async ({ wallet, tokenBalance, ataExists }) => {
        const agg = aggregateMap.get(wallet.publicKey) ?? {
          buy: { sol: 0, tokens: 0 },
          sell: { sol: 0 },
        };
        const totalBuyAmount = agg.buy.sol;
        const totalSellAmount = agg.sell.sol;
        const totalBuyTokens = agg.buy.tokens;
        const averageBuyPrice =
          totalBuyTokens > 0 ? totalBuyAmount / totalBuyTokens : 0;
        const lastTxSignature = lastTxMap.get(wallet.publicKey) ?? "";
        const existingId = existingHoldingMap.get(wallet.publicKey);

        if (tokenBalance > 0 || ataExists) {
          if (existingId) {
            return prisma.holding.update({
              where: { id: existingId },
              data: {
                tokenBalance,
                totalBuyAmount,
                totalSellAmount,
                averageBuyPrice,
                lastTransactionSignature: lastTxSignature,
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
              lastTransactionSignature: lastTxSignature,
              lastUpdated: now,
              mintAddress: token.publicKey,
              tokenName: token.name,
              tokenSymbol: token.symbol,
              tokenImageUrl: token.imageUrl ?? "",
              tokenDecimals: mintDecimals,
            },
          });
        }

        if (existingId) {
          await prisma.holding.delete({ where: { id: existingId } });
        }

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
    const shouldCloseAta = Boolean(input.closeAta);
    const mainWalletRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        mainWallet: {
          select: { publicKey: true, privateKey: true },
        },
      },
    });
    const mainWalletKeypair = mainWalletRecord?.mainWallet?.privateKey
      ? Keypair.fromSecretKey(bs58.decode(mainWalletRecord.mainWallet.privateKey))
      : null;

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
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            walletPublicKey: wallet.publicKey,
            status: "FAILED",
            error: message,
          };
        }
      })
    );

    const ataCloseResults = shouldCloseAta
      ? await mapWithConcurrency(wallets, 2, async (wallet) => {
          try {
            const owner = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
            const ata = await getAssociatedTokenAddress(
              mintPublicKey,
              owner.publicKey
            );
            const feePayer =
              mainWalletKeypair &&
              mainWalletKeypair.publicKey.toBase58() !==
                owner.publicKey.toBase58()
                ? mainWalletKeypair
                : owner;
            const destination = mainWalletKeypair?.publicKey ?? owner.publicKey;
            let account;
            try {
              account = await getAccount(connection, ata);
            } catch (error) {
              if (
                error instanceof Error &&
                (error.message.includes("Account does not exist") ||
                  error.message.includes("could not find account") ||
                  error.name === "TokenAccountNotFoundError")
              ) {
                return {
                  walletPublicKey: wallet.publicKey,
                  status: "SKIPPED",
                  error: "ATA not found",
                };
              }
              throw error;
            }

            if (account.amount > BigInt(0)) {
              return {
                walletPublicKey: wallet.publicKey,
                status: "SKIPPED",
                error: "Balance not zero",
              };
            }

            const closeTx = new Transaction().add(
              createCloseAccountInstruction(
                ata,
                destination,
                owner.publicKey
              )
            );
            const { blockhash, lastValidBlockHeight } =
              await connection.getLatestBlockhash("confirmed");
            closeTx.recentBlockhash = blockhash;
            closeTx.lastValidBlockHeight = lastValidBlockHeight;
            closeTx.feePayer = feePayer.publicKey;
            const signers =
              feePayer.publicKey.toBase58() === owner.publicKey.toBase58()
                ? [feePayer]
                : [feePayer, owner];
            await sendAndConfirmTransaction(connection, closeTx, signers, {
              commitment: "confirmed",
            });

            return { walletPublicKey: wallet.publicKey, status: "CLOSED" };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return {
              walletPublicKey: wallet.publicKey,
              status: "FAILED",
              error: message,
            };
          }
        })
      : [];

    const submitted = results.filter((result) => result.status === "SUBMITTED");
    const failed = results.filter((result) => result.status === "FAILED");
    const ataClosed = ataCloseResults.filter(
      (result) => result.status === "CLOSED"
    );
    const ataCloseFailed = ataCloseResults.filter(
      (result) => result.status === "FAILED"
    );

    return {
      tokenPublicKey: token.publicKey,
      submitted: submitted.length,
      failed: failed.length,
      results,
      ataClose: shouldCloseAta
        ? {
            closed: ataClosed.length,
            failed: ataCloseFailed.length,
            results: ataCloseResults,
          }
        : null,
    };
  },
};

export type HoldingItem = Awaited<
  ReturnType<typeof holdingService.listByToken>
>[number];
