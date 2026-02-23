import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { AppError } from "@/server/errors";
import { getSolanaConnection } from "@/lib/solana/connection";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { walletService } from "@/server/services/wallet.service";
import { retryRpc } from "@/lib/utils/rpc-retry";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  Keypair,
  PublicKey,
  SystemProgram,
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

const HOLDING_MUTATION_BATCH_SIZE = 100;
const HOLDING_RPC_BATCH_SIZE = 100;
const HOLDING_RPC_CONCURRENCY = 3;
const HOLDING_MUTATION_CONCURRENCY = 3;

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

async function returnSolToMainWallet(
  connection: Connection,
  wallets: WalletWithKey[],
  mainWalletKeypair: Keypair
) {
  const results = await mapWithConcurrency(wallets, 2, async (wallet) => {
    if (wallet.publicKey === mainWalletKeypair.publicKey.toBase58()) {
      return {
        walletPublicKey: wallet.publicKey,
        status: "SKIPPED",
        recoveredLamports: 0,
      };
    }

    try {
      const owner = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
      const balanceLamports = await connection.getBalance(owner.publicKey);
      if (balanceLamports <= 0) {
        return {
          walletPublicKey: wallet.publicKey,
          status: "SKIPPED",
          recoveredLamports: 0,
        };
      }

      const feeTransaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: mainWalletKeypair.publicKey,
          lamports: 1,
        })
      );
      const feePayer = owner.publicKey;
      feeTransaction.feePayer = feePayer;
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");
      feeTransaction.recentBlockhash = latestBlockhash.blockhash;
      const fee = await connection.getFeeForMessage(
        feeTransaction.compileMessage(),
        "confirmed"
      );
      const feeLamports = fee.value ?? 5000;
      const lamports = balanceLamports - feeLamports;
      if (lamports <= 0) {
        return {
          walletPublicKey: wallet.publicKey,
          status: "SKIPPED",
          recoveredLamports: 0,
        };
      }

      const transferTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: mainWalletKeypair.publicKey,
          lamports,
        })
      );
      transferTx.recentBlockhash = latestBlockhash.blockhash;
      transferTx.feePayer = owner.publicKey;
      await sendAndConfirmTransaction(connection, transferTx, [owner], {
        commitment: "confirmed",
      });

      return {
        walletPublicKey: wallet.publicKey,
        status: "RECOVERED",
        recoveredLamports: lamports,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        walletPublicKey: wallet.publicKey,
        status: "FAILED",
        recoveredLamports: 0,
        error: message,
      };
    }
  });

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
    results,
  };
}

type BalanceResult = {
  wallet: WalletRecord;
  tokenBalance: number;
  ataExists: boolean;
  isResolved: boolean;
};

async function fetchBalancesViaRpc(
  wallets: WalletRecord[],
  tokenPublicKey: string
): Promise<{ results: BalanceResult[]; mintDecimals: number }> {
  const connection = getSolanaConnection();
  const mintPubkey = new PublicKey(tokenPublicKey);
  const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
  const mintDecimals =
    (
      mintInfo.value?.data as {
        parsed?: { info?: { decimals?: number } };
      }
    )?.parsed?.info?.decimals ?? 9;

  const atas = await Promise.all(
    wallets.map(async (wallet) => ({
      wallet,
      ata: await getAssociatedTokenAddress(mintPubkey, new PublicKey(wallet.publicKey)),
    }))
  );

  type ParsedAccountInfoItem = Awaited<
    ReturnType<Connection["getMultipleParsedAccounts"]>
  >["value"][number];
  const ataAddresses = atas.map((a) => a.ata);
  const ataBatches: PublicKey[][] = [];
  for (let i = 0; i < ataAddresses.length; i += HOLDING_RPC_BATCH_SIZE) {
    ataBatches.push(ataAddresses.slice(i, i + HOLDING_RPC_BATCH_SIZE));
  }
  const batchedInfos = await mapWithConcurrency(
    ataBatches,
    HOLDING_RPC_CONCURRENCY,
    async (batch) =>
      await retryRpc(() => connection.getMultipleParsedAccounts(batch))
  );
  const accountInfos: ParsedAccountInfoItem[] = batchedInfos.flatMap(
    (batchInfo) => batchInfo.value
  );

  const results = atas.map(({ wallet }, index) => {
    const accountInfo = accountInfos[index];
    const ataExists = Boolean(accountInfo?.data);
    let tokenBalance = 0;
    if (accountInfo?.data && "parsed" in accountInfo.data) {
      const parsed = accountInfo.data.parsed as {
        info?: { tokenAmount?: { uiAmount?: number } };
      };
      tokenBalance = parsed?.info?.tokenAmount?.uiAmount ?? 0;
    }
    return { wallet, tokenBalance, ataExists, isResolved: true };
  });

  return { results, mintDecimals };
}

async function fetchBalances(
  wallets: WalletRecord[],
  tokenPublicKey: string
): Promise<{ results: BalanceResult[]; mintDecimals: number }> {
  return await fetchBalancesViaRpc(wallets, tokenPublicKey);
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

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 10;
    const skip = (page - 1) * pageSize;
    const take = pageSize;
    const where = {
      tokenPublicKey: input.tokenPublicKey,
      ...(input.walletPublicKey ? { walletPublicKey: input.walletPublicKey } : {}),
    };

    const [holdings, totalCount, balanceAgg, totalSupply] = await Promise.all([
      prisma.holding.findMany({
        where,
        include: {
          wallet: {
            select: { publicKey: true, type: true },
          },
        },
        orderBy: { lastUpdated: "desc" },
        skip,
        take,
      }),
      prisma.holding.count({ where }),
      prisma.holding.aggregate({
        where: {
          tokenPublicKey: input.tokenPublicKey,
          ...(input.walletPublicKey
            ? { walletPublicKey: input.walletPublicKey }
            : {}),
        },
        _sum: { tokenBalance: true },
      }),
      (async () => {
        try {
          const connection = getSolanaConnection();
          const mint = new PublicKey(input.tokenPublicKey);
          const supply = await connection.getTokenSupply(mint);
          return Number(supply.value.uiAmountString ?? "0");
        } catch {
          return null;
        }
      })(),
    ]);

    return {
      holdings,
      totalCount,
      totalBalance: Number(balanceAgg._sum.tokenBalance ?? 0),
      totalSupply,
    };
  },

  async refreshByToken(input: RefreshHoldingsByTokenInput, userId: string) {
    const { token, wallets } = await getAllowedWallets(
      input.tokenPublicKey,
      userId,
      input.walletPublicKeys
    );

    const walletPublicKeys = wallets.map((w) => w.publicKey);

    const [balanceResults, existingHoldings] = await Promise.all([
      fetchBalances(wallets, token.publicKey),
      prisma.holding.findMany({
        where: {
          walletPublicKey: { in: walletPublicKeys },
          tokenPublicKey: token.publicKey,
        },
        select: {
          id: true,
          walletPublicKey: true,
          tokenBalance: true,
          totalBuyAmount: true,
          totalSellAmount: true,
          averageBuyPrice: true,
          lastTransactionSignature: true,
          mintAddress: true,
          tokenName: true,
          tokenSymbol: true,
          tokenImageUrl: true,
          tokenDecimals: true,
        },
      }),
    ]);

    const existingHoldingMap = new Map<
      string,
      (typeof existingHoldings)[number]
    >();
    for (const holding of existingHoldings) {
      existingHoldingMap.set(holding.walletPublicKey, holding);
    }

    const persistedCandidates = balanceResults.results.filter(
      (result) => result.isResolved && (result.tokenBalance > 0 || result.ataExists)
    );
    const candidateWalletPublicKeys = persistedCandidates.map(
      (result) => result.wallet.publicKey
    );

    const lastTransactions =
      candidateWalletPublicKeys.length > 0
        ? await prisma.$queryRaw<
            Array<{ walletPublicKey: string; transactionSignature: string }>
          >`
              SELECT DISTINCT ON ("walletPublicKey") 
                "walletPublicKey", 
                "transactionSignature"
              FROM "Transaction"
              WHERE "walletPublicKey" = ANY(${candidateWalletPublicKeys})
                AND "tokenPublicKey" = ${token.publicKey}
              ORDER BY "walletPublicKey", "createdAt" DESC
            `
        : [];

    const lastTxMap = new Map<string, string>();
    for (const tx of lastTransactions) {
      lastTxMap.set(tx.walletPublicKey, tx.transactionSignature);
    }

    const mintDecimals = balanceResults.mintDecimals;
    const tokenImageUrl = token.imageUrl ?? "";
    const now = new Date();
    const createManyData: Prisma.HoldingCreateManyInput[] = [];
    const deleteIds: string[] = [];
    const updateInputs: Array<{
      id: string;
      data: Prisma.HoldingUpdateInput;
    }> = [];

    for (const { wallet, tokenBalance, ataExists, isResolved } of balanceResults.results) {
      if (!isResolved) {
        continue;
      }

      const shouldPersist = tokenBalance > 0 || ataExists;
      const existing = existingHoldingMap.get(wallet.publicKey);

      if (!shouldPersist) {
        if (existing) {
          deleteIds.push(existing.id);
        }
        continue;
      }

      const lastTxSignature = lastTxMap.get(wallet.publicKey) ?? "";
      const baseData = {
        tokenBalance,
        totalBuyAmount: 0,
        totalSellAmount: 0,
        averageBuyPrice: 0,
        lastTransactionSignature: lastTxSignature,
        mintAddress: token.publicKey,
        tokenName: token.name,
        tokenSymbol: token.symbol,
        tokenImageUrl,
        tokenDecimals: mintDecimals,
      };

      if (!existing) {
        createManyData.push({
          walletPublicKey: wallet.publicKey,
          tokenPublicKey: token.publicKey,
          ...baseData,
          lastUpdated: now,
        });
        continue;
      }

      const hasChanges =
        Number(existing.tokenBalance) !== tokenBalance ||
        Number(existing.totalBuyAmount) !== 0 ||
        Number(existing.totalSellAmount) !== 0 ||
        Number(existing.averageBuyPrice) !== 0 ||
        existing.lastTransactionSignature !== lastTxSignature ||
        existing.mintAddress !== token.publicKey ||
        existing.tokenName !== token.name ||
        existing.tokenSymbol !== token.symbol ||
        existing.tokenImageUrl !== tokenImageUrl ||
        existing.tokenDecimals !== mintDecimals;

      if (!hasChanges) {
        continue;
      }

      updateInputs.push({
        id: existing.id,
        data: {
          ...baseData,
          lastUpdated: now,
        },
      });
    }

    if (deleteIds.length > 0) {
      const deleteBatches: string[][] = [];
      for (let i = 0; i < deleteIds.length; i += HOLDING_MUTATION_BATCH_SIZE) {
        deleteBatches.push(deleteIds.slice(i, i + HOLDING_MUTATION_BATCH_SIZE));
      }
      await mapWithConcurrency(
        deleteBatches,
        HOLDING_MUTATION_CONCURRENCY,
        async (batch) =>
          await prisma.holding.deleteMany({
            where: { id: { in: batch } },
          })
      );
    }
    if (createManyData.length > 0) {
      const createBatches: Prisma.HoldingCreateManyInput[][] = [];
      for (
        let i = 0;
        i < createManyData.length;
        i += HOLDING_MUTATION_BATCH_SIZE
      ) {
        createBatches.push(
          createManyData.slice(i, i + HOLDING_MUTATION_BATCH_SIZE)
        );
      }
      await mapWithConcurrency(
        createBatches,
        HOLDING_MUTATION_CONCURRENCY,
        async (batch) =>
          await prisma.holding.createMany({
            data: batch,
          })
      );
    }
    if (updateInputs.length > 0) {
      const updateBatches: Array<typeof updateInputs> = [];
      for (let i = 0; i < updateInputs.length; i += HOLDING_MUTATION_BATCH_SIZE) {
        updateBatches.push(updateInputs.slice(i, i + HOLDING_MUTATION_BATCH_SIZE));
      }
      await mapWithConcurrency(
        updateBatches,
        HOLDING_MUTATION_CONCURRENCY,
        async (batch) =>
          await prisma.$transaction(
            batch.map((update) =>
              prisma.holding.update({
                where: { id: update.id },
                data: update.data,
              })
            )
          )
      );
    }

    await refreshCacheService.touch({
      userId,
      tokenPublicKey: token.publicKey,
      scope: "HOLDINGS",
    });
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
    const shouldReturnSolToMainWallet = Boolean(input.returnSolToMainWallet);
    const mainWalletRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        mainWallet: {
          select: { publicKey: true, privateKey: true },
        },
      },
    });
    const mainWalletKeypair = mainWalletRecord?.mainWallet?.privateKey
      ? Keypair.fromSecretKey(
          bs58.decode(mainWalletRecord.mainWallet.privateKey)
        )
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
          const feePayer =
            mainWalletKeypair &&
            mainWalletKeypair.publicKey.toBase58() !==
              seller.publicKey.toBase58()
              ? mainWalletKeypair
              : seller;
          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash("confirmed");
          tx.recentBlockhash = blockhash;
          tx.lastValidBlockHeight = lastValidBlockHeight;
          tx.feePayer = feePayer.publicKey;
          const signers =
            feePayer.publicKey.toBase58() === seller.publicKey.toBase58()
              ? [seller]
              : [feePayer, seller];
          const signature = await sendAndConfirmTransaction(
            connection,
            tx,
            signers,
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
              createCloseAccountInstruction(ata, destination, owner.publicKey)
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

    if (shouldReturnSolToMainWallet && !mainWalletKeypair) {
      throw new AppError("Main wallet not found", 400);
    }

    const solRecovery =
      shouldReturnSolToMainWallet && mainWalletKeypair
        ? await returnSolToMainWallet(connection, wallets, mainWalletKeypair)
        : null;

    const refreshWalletPublicKeys = Array.from(
      new Set([
        ...wallets.map((wallet) => wallet.publicKey),
        ...(mainWalletKeypair ? [mainWalletKeypair.publicKey.toBase58()] : []),
      ])
    );
    if (refreshWalletPublicKeys.length > 0) {
      try {
        await walletService.refreshWalletBalances(
          token.publicKey,
          userId,
          refreshWalletPublicKeys,
          true
        );
      } catch {}
    }

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
      solRecovery,
    };
  },
};

export type HoldingItem = Awaited<
  ReturnType<typeof holdingService.listByToken>
>["holdings"][number];
