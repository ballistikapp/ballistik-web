import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import { getSolanaConnection } from "@/lib/solana/connection";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { tokenTransactionsGrpc } from "@/server/solana/token-transactions-grpc";
import { derivePumpAddresses } from "@/server/solana/pump-new-idl";
import {
  LAMPORTS_PER_SOL,
  type ParsedTransactionWithMeta,
  PublicKey,
} from "@solana/web3.js";
import { type WalletType } from "@/lib/generated/prisma/enums";
import type {
  ListTransactionsByTokenInput,
  LiveTransactionsByTokenInput,
  RefreshTransactionsByTokenInput,
} from "@/server/schemas/transaction.schema";

type WalletRecord = {
  publicKey: string;
  type: WalletType;
};

type ParsedTransactionResult = {
  walletPublicKey: string;
  transactionType: "BUY" | "SELL" | "CREATE";
  status: "CONFIRMED" | "FAILED";
  transactionSignature: string;
  solAmount: number;
  tokenAmount: number;
  pricePerToken: number;
  slippageBps: number;
  feeAmount: number;
  blockTime: Date | null;
};

type LiveTransactionItem = ParsedTransactionResult & {
  isOwned: boolean;
  walletType: WalletType | null;
  seenAt: Date;
};

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

type TokenBalanceEntry = NonNullable<
  NonNullable<ParsedTransactionWithMeta["meta"]>["preTokenBalances"]
>[number];

function sumTokenBalances(
  balances: TokenBalanceEntry[] | null | undefined,
  owner: string,
  mint: string
) {
  if (!balances?.length) return 0;
  return balances.reduce((total, balance) => {
    if (balance.owner !== owner || balance.mint !== mint) return total;
    const amount = balance.uiTokenAmount?.uiAmount ?? 0;
    return total + amount;
  }, 0);
}

function sumTokenBalancesByOwner(
  balances: TokenBalanceEntry[] | null | undefined,
  mint: string
) {
  const totals = new Map<string, number>();
  if (!balances?.length) return totals;
  balances.forEach((balance) => {
    if (balance.mint !== mint || !balance.owner) return;
    const amount = balance.uiTokenAmount?.uiAmount ?? 0;
    totals.set(balance.owner, (totals.get(balance.owner) ?? 0) + amount);
  });
  return totals;
}

function getWrappedSolDiff(
  tx: ParsedTransactionWithMeta,
  walletPublicKey: string
) {
  if (!tx.meta) return 0;
  const preBalance = sumTokenBalances(
    tx.meta.preTokenBalances,
    walletPublicKey,
    WRAPPED_SOL_MINT
  );
  const postBalance = sumTokenBalances(
    tx.meta.postTokenBalances,
    walletPublicKey,
    WRAPPED_SOL_MINT
  );
  return postBalance - preBalance;
}

function resolveAccountKey(
  key: ParsedTransactionWithMeta["transaction"]["message"]["accountKeys"][number]
) {
  if (typeof key === "string") return key;
  if (key && typeof key === "object" && "pubkey" in key) {
    const maybePubkey = key.pubkey;
    if (
      maybePubkey &&
      typeof maybePubkey === "object" &&
      "toBase58" in maybePubkey &&
      typeof maybePubkey.toBase58 === "function"
    ) {
      return maybePubkey.toBase58();
    }
  }
  if (key && typeof key === "object" && "toBase58" in key) {
    const toBase58 = key.toBase58;
    if (typeof toBase58 === "function") {
      return toBase58.call(key);
    }
  }
  return null;
}

function getSystemSolDiff(
  tx: ParsedTransactionWithMeta,
  walletPublicKey: string
) {
  const accountIndex = tx.transaction.message.accountKeys.findIndex(
    (key) => resolveAccountKey(key) === walletPublicKey
  );
  if (accountIndex === -1) return 0;
  const preSolBalance = tx.meta?.preBalances?.[accountIndex];
  const postSolBalance = tx.meta?.postBalances?.[accountIndex];
  if (preSolBalance === undefined || postSolBalance === undefined) return 0;
  return (postSolBalance - preSolBalance) / LAMPORTS_PER_SOL;
}

function getWrappedSolDiffForOwner(
  tx: ParsedTransactionWithMeta,
  walletPublicKey: string
) {
  if (!tx.meta) return 0;
  const preBalance = sumTokenBalances(
    tx.meta.preTokenBalances,
    walletPublicKey,
    WRAPPED_SOL_MINT
  );
  const postBalance = sumTokenBalances(
    tx.meta.postTokenBalances,
    walletPublicKey,
    WRAPPED_SOL_MINT
  );
  return postBalance - preBalance;
}

async function getAllowedWallets(
  tokenPublicKey: string,
  userId: string,
  walletPublicKeys?: string[]
) {
  const token = await prisma.token.findFirst({
    where: { publicKey: tokenPublicKey, userId },
    select: { publicKey: true },
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

function parseTransactionForToken(
  signature: string,
  tx: ParsedTransactionWithMeta | null,
  walletPublicKey: string,
  tokenPublicKey: string
): ParsedTransactionResult | null {
  if (!tx || !tx.meta) {
    return null;
  }

  const preTokenBalance = tx.meta.preTokenBalances?.find(
    (balance) =>
      balance.owner === walletPublicKey && balance.mint === tokenPublicKey
  );
  const postTokenBalance = tx.meta.postTokenBalances?.find(
    (balance) =>
      balance.owner === walletPublicKey && balance.mint === tokenPublicKey
  );

  if (!preTokenBalance && !postTokenBalance) {
    return null;
  }

  const tokenDiff =
    (postTokenBalance?.uiTokenAmount?.uiAmount || 0) -
    (preTokenBalance?.uiTokenAmount?.uiAmount || 0);

  if (tokenDiff === 0) {
    return null;
  }

  const accountIndex = tx.transaction.message.accountKeys.findIndex(
    (key) => key.pubkey.toBase58() === walletPublicKey
  );

  let systemSolDiff = 0;
  if (accountIndex !== -1) {
    const preSolBalance = tx.meta.preBalances[accountIndex];
    const postSolBalance = tx.meta.postBalances[accountIndex];
    if (preSolBalance !== undefined && postSolBalance !== undefined) {
      systemSolDiff = (postSolBalance - preSolBalance) / LAMPORTS_PER_SOL;
    }
  }

  const wrappedSolDiff = getWrappedSolDiff(tx, walletPublicKey);
  const solDiff =
    Math.abs(wrappedSolDiff) > Math.abs(systemSolDiff)
      ? wrappedSolDiff
      : systemSolDiff;

  const isCreate = tx.meta.logMessages?.some(
    (log) =>
      log.includes("Instruction: InitializeMint") ||
      log.includes("Instruction: Create")
  );

  if (tokenDiff > 0) {
    const solAmount = Math.max(0, -solDiff);
    const tokenAmount = tokenDiff;
    return {
      walletPublicKey,
      transactionType: isCreate ? "CREATE" : "BUY",
      status: tx.meta?.err ? "FAILED" : "CONFIRMED",
      transactionSignature: signature,
      solAmount,
      tokenAmount,
      pricePerToken: tokenAmount ? solAmount / tokenAmount : 0,
      slippageBps: 0,
      feeAmount: (tx.meta?.fee ?? 0) / LAMPORTS_PER_SOL,
      blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
    };
  }

  const solAmount = Math.max(0, solDiff);
  const tokenAmount = Math.abs(tokenDiff);
  return {
    walletPublicKey,
    transactionType: "SELL",
    status: tx.meta?.err ? "FAILED" : "CONFIRMED",
    transactionSignature: signature,
    solAmount,
    tokenAmount,
    pricePerToken: tokenAmount ? solAmount / tokenAmount : 0,
    slippageBps: 0,
    feeAmount: (tx.meta?.fee ?? 0) / LAMPORTS_PER_SOL,
    blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
  };
}

function parseTransactionForTokenOwners(
  signature: string,
  tx: ParsedTransactionWithMeta | null,
  tokenPublicKey: string
): ParsedTransactionResult[] {
  if (!tx || !tx.meta) {
    return [];
  }

  const preByOwner = sumTokenBalancesByOwner(
    tx.meta.preTokenBalances,
    tokenPublicKey
  );
  const postByOwner = sumTokenBalancesByOwner(
    tx.meta.postTokenBalances,
    tokenPublicKey
  );

  const owners = new Set<string>([
    ...Array.from(preByOwner.keys()),
    ...Array.from(postByOwner.keys()),
  ]);

  if (owners.size === 0) {
    return [];
  }

  const isCreate = tx.meta.logMessages?.some(
    (log) =>
      log.includes("Instruction: InitializeMint") ||
      log.includes("Instruction: Create")
  );

  const results: ParsedTransactionResult[] = [];

  owners.forEach((owner) => {
    const preAmount = preByOwner.get(owner) ?? 0;
    const postAmount = postByOwner.get(owner) ?? 0;
    const tokenDiff = postAmount - preAmount;
    if (tokenDiff === 0) return;

    const systemSolDiff = getSystemSolDiff(tx, owner);
    const wrappedSolDiff = getWrappedSolDiffForOwner(tx, owner);
    const solDiff =
      Math.abs(wrappedSolDiff) > Math.abs(systemSolDiff)
        ? wrappedSolDiff
        : systemSolDiff;

    if (tokenDiff > 0) {
      const solAmount = Math.max(0, -solDiff);
      const tokenAmount = tokenDiff;
      results.push({
        walletPublicKey: owner,
        transactionType: isCreate ? "CREATE" : "BUY",
        status: tx.meta?.err ? "FAILED" : "CONFIRMED",
        transactionSignature: signature,
        solAmount,
        tokenAmount,
        pricePerToken: tokenAmount ? solAmount / tokenAmount : 0,
        slippageBps: 0,
        feeAmount: (tx.meta?.fee ?? 0) / LAMPORTS_PER_SOL,
        blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
      });
      return;
    }

    const solAmount = Math.max(0, solDiff);
    const tokenAmount = Math.abs(tokenDiff);
    results.push({
      walletPublicKey: owner,
      transactionType: "SELL",
      status: tx.meta?.err ? "FAILED" : "CONFIRMED",
      transactionSignature: signature,
      solAmount,
      tokenAmount,
      pricePerToken: tokenAmount ? solAmount / tokenAmount : 0,
      slippageBps: 0,
      feeAmount: (tx.meta?.fee ?? 0) / LAMPORTS_PER_SOL,
      blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
    });
  });

  return results;
}

export const transactionService = {
  async listByToken(input: ListTransactionsByTokenInput, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey: input.tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    return await prisma.transaction.findMany({
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
      orderBy: { createdAt: "desc" },
    });
  },

  async refreshByToken(input: RefreshTransactionsByTokenInput, userId: string) {
    const { token, wallets } = await getAllowedWallets(
      input.tokenPublicKey,
      userId,
      input.walletPublicKeys
    );

    const connection = getSolanaConnection();
    const signatureWallets = new Map<string, Set<string>>();
    const walletPublicKeys = wallets.map((wallet) => wallet.publicKey);
    const signatureLimit = 100;

    for (const wallet of wallets) {
      const walletPublicKey = new PublicKey(wallet.publicKey);
      const signatures = await connection.getSignaturesForAddress(
        walletPublicKey,
        { limit: signatureLimit }
      );
      signatures.forEach((signatureInfo) => {
        const existing = signatureWallets.get(signatureInfo.signature);
        if (existing) {
          existing.add(wallet.publicKey);
        } else {
          signatureWallets.set(
            signatureInfo.signature,
            new Set([wallet.publicKey])
          );
        }
      });
    }

    const staleTransactions = await prisma.transaction.findMany({
      where: {
        tokenPublicKey: token.publicKey,
        walletPublicKey: { in: walletPublicKeys },
        OR: [{ pricePerToken: 0 }, { solAmount: 0 }],
      },
      select: { transactionSignature: true, walletPublicKey: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    staleTransactions.forEach((transaction) => {
      const existing = signatureWallets.get(transaction.transactionSignature);
      if (existing) {
        existing.add(transaction.walletPublicKey);
      } else {
        signatureWallets.set(
          transaction.transactionSignature,
          new Set([transaction.walletPublicKey])
        );
      }
    });

    const signatures = Array.from(signatureWallets.keys());
    if (signatures.length === 0) {
      await refreshCacheService.touch({
        userId,
        tokenPublicKey: token.publicKey,
        scope: "TRANSACTIONS",
      });
      return [];
    }

    const parsedBySignature = new Map<
      string,
      ParsedTransactionWithMeta | null
    >();
    const batchSize = 20;
    for (let i = 0; i < signatures.length; i += batchSize) {
      const batch = signatures.slice(i, i + batchSize);
      const parsedBatch = await connection.getParsedTransactions(batch, {
        maxSupportedTransactionVersion: 0,
      });
      parsedBatch.forEach((parsed, index) => {
        const signature = batch[index];
        if (signature) {
          parsedBySignature.set(signature, parsed);
        }
      });
    }

    const parsedTransactions: ParsedTransactionResult[] = [];
    signatureWallets.forEach((walletSet, signature) => {
      const parsed = parsedBySignature.get(signature) ?? null;
      if (!parsed) return;
      walletSet.forEach((walletPublicKey) => {
        const result = parseTransactionForToken(
          signature,
          parsed,
          walletPublicKey,
          token.publicKey
        );
        if (result) {
          parsedTransactions.push(result);
        }
      });
    });

    if (parsedTransactions.length === 0) {
      await refreshCacheService.touch({
        userId,
        tokenPublicKey: token.publicKey,
        scope: "TRANSACTIONS",
      });
      return [];
    }

    const parsedByKey = new Map<string, ParsedTransactionResult>();
    parsedTransactions.forEach((transaction) => {
      const key = `${transaction.walletPublicKey}:${transaction.transactionSignature}`;
      if (!parsedByKey.has(key)) {
        parsedByKey.set(key, transaction);
      }
    });
    const uniqueSignatures = Array.from(
      new Set(
        Array.from(parsedByKey.values()).map((tx) => tx.transactionSignature)
      )
    );

    const existing = await prisma.transaction.findMany({
      where: {
        tokenPublicKey: token.publicKey,
        transactionSignature: { in: uniqueSignatures },
        walletPublicKey: { in: wallets.map((wallet) => wallet.publicKey) },
      },
      select: {
        id: true,
        transactionSignature: true,
        walletPublicKey: true,
        solAmount: true,
        tokenAmount: true,
        pricePerToken: true,
      },
    });

    const existingByKey = new Map(
      existing.map((transaction) => [
        `${transaction.walletPublicKey}:${transaction.transactionSignature}`,
        transaction,
      ])
    );

    const newTransactions = Array.from(parsedByKey.entries())
      .filter(([key]) => !existingByKey.has(key))
      .map(([, transaction]) => transaction);

    const updates = Array.from(parsedByKey.entries())
      .map(([key, transaction]) => {
        const existingTx = existingByKey.get(key);
        if (!existingTx) return null;
        const existingPrice = Number(existingTx.pricePerToken ?? 0);
        const existingSol = Number(existingTx.solAmount ?? 0);
        const existingToken = Number(existingTx.tokenAmount ?? 0);
        const shouldUpdate =
          (existingPrice === 0 && transaction.pricePerToken > 0) ||
          (existingSol === 0 && transaction.solAmount > 0) ||
          (existingToken === 0 && transaction.tokenAmount > 0);
        if (!shouldUpdate) return null;
        return {
          id: existingTx.id,
          data: {
            solAmount: transaction.solAmount,
            tokenAmount: transaction.tokenAmount,
            pricePerToken: transaction.pricePerToken,
            feeAmount: transaction.feeAmount,
            blockTime: transaction.blockTime,
          },
        };
      })
      .filter(
        (
          update
        ): update is {
          id: string;
          data: {
            solAmount: number;
            tokenAmount: number;
            pricePerToken: number;
            feeAmount: number;
            blockTime: Date | null;
          };
        } => Boolean(update)
      );

    if (newTransactions.length > 0) {
      await prisma.transaction.createMany({
        data: newTransactions.map((transaction) => ({
          walletPublicKey: transaction.walletPublicKey,
          tokenPublicKey: token.publicKey,
          transactionType: transaction.transactionType,
          status: transaction.status,
          transactionSignature: transaction.transactionSignature,
          solAmount: transaction.solAmount,
          tokenAmount: transaction.tokenAmount,
          pricePerToken: transaction.pricePerToken,
          slippageBps: transaction.slippageBps,
          feeAmount: transaction.feeAmount,
          blockTime: transaction.blockTime,
        })),
      });
    }

    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map((update) =>
          prisma.transaction.update({
            where: { id: update.id },
            data: update.data,
          })
        )
      );
    }

    await refreshCacheService.touch({
      userId,
      tokenPublicKey: token.publicKey,
      scope: "TRANSACTIONS",
    });

    return newTransactions;
  },
  async liveByToken(input: LiveTransactionsByTokenInput, userId: string) {
    const limit = Math.min(Math.max(input.limit ?? 60, 10), 200);
    const { token, wallets } = await getAllowedWallets(
      input.tokenPublicKey,
      userId
    );

    const ownedWallets = new Map(
      wallets.map((wallet) => [wallet.publicKey, wallet.type])
    );

    const mint = new PublicKey(token.publicKey);
    const { bondingCurve } = derivePumpAddresses(mint);

    await tokenTransactionsGrpc.subscribeToToken(token.publicKey, [
      token.publicKey,
      bondingCurve.toBase58(),
    ]);

    const streamStatus = tokenTransactionsGrpc.getStatus();
    const state = tokenTransactionsGrpc.getState(token.publicKey);
    if (!state) {
      return {
        tokenPublicKey: token.publicKey,
        transactions: [],
        totals: {
          totalLiquiditySol: 0,
          foreignLiquiditySol: 0,
        },
        streamStatus,
      };
    }

    const signatureEntries = state.signatures.slice(0, limit * 4);
    const missingSignatures = signatureEntries
      .filter((entry) => !state.parsedBySignature.has(entry.signature))
      .map((entry) => entry.signature);

    if (missingSignatures.length > 0) {
      const connection = getSolanaConnection();
      const parsedBatch = await connection.getParsedTransactions(
        missingSignatures,
        { maxSupportedTransactionVersion: 0 }
      );
      parsedBatch.forEach((parsed, index) => {
        const signature = missingSignatures[index];
        if (signature) {
          state.parsedBySignature.set(signature, parsed ?? null);
        }
      });
    }

    const entries: LiveTransactionItem[] = [];

    signatureEntries.forEach((entry) => {
      const parsed = state.parsedBySignature.get(entry.signature) ?? null;
      const parsedEntries = parseTransactionForTokenOwners(
        entry.signature,
        parsed,
        token.publicKey
      );
      parsedEntries.forEach((transaction) => {
        const walletType =
          ownedWallets.get(transaction.walletPublicKey) ?? null;
        entries.push({
          ...transaction,
          isOwned: Boolean(walletType),
          walletType,
          seenAt: new Date(entry.seenAt),
        });
      });
    });

    entries.sort((a, b) => {
      const aTime = (a.blockTime ?? a.seenAt).getTime();
      const bTime = (b.blockTime ?? b.seenAt).getTime();
      return bTime - aTime;
    });

    const transactions = entries.slice(0, limit);
    const totalLiquiditySol = transactions.reduce(
      (sum, tx) => sum + tx.solAmount,
      0
    );
    const foreignLiquiditySol = transactions.reduce(
      (sum, tx) => (tx.isOwned ? sum : sum + tx.solAmount),
      0
    );

    return {
      tokenPublicKey: token.publicKey,
      transactions,
      totals: {
        totalLiquiditySol,
        foreignLiquiditySol,
      },
      streamStatus,
    };
  },
};

export type TransactionItem = Awaited<
  ReturnType<typeof transactionService.listByToken>
>[number];

export type LiveTransactionResponse = Awaited<
  ReturnType<typeof transactionService.liveByToken>
>;
