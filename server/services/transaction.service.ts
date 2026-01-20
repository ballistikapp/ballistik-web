import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import { getSolanaConnection } from "@/lib/solana/connection";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import {
  LAMPORTS_PER_SOL,
  type ParsedTransactionWithMeta,
  PublicKey,
} from "@solana/web3.js";
import { type WalletType } from "@/lib/generated/prisma/enums";
import type {
  ListTransactionsByTokenInput,
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
      status: tx.meta.err ? "FAILED" : "CONFIRMED",
      transactionSignature: signature,
      solAmount,
      tokenAmount,
      pricePerToken: tokenAmount ? solAmount / tokenAmount : 0,
      slippageBps: 0,
      feeAmount: (tx.meta.fee ?? 0) / LAMPORTS_PER_SOL,
      blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
    };
  }

  const solAmount = Math.max(0, solDiff);
  const tokenAmount = Math.abs(tokenDiff);
  return {
    walletPublicKey,
    transactionType: "SELL",
    status: tx.meta.err ? "FAILED" : "CONFIRMED",
    transactionSignature: signature,
    solAmount,
    tokenAmount,
    pricePerToken: tokenAmount ? solAmount / tokenAmount : 0,
    slippageBps: 0,
    feeAmount: (tx.meta.fee ?? 0) / LAMPORTS_PER_SOL,
    blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
  };
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
        Array.from(parsedByKey.values()).map(
          (tx) => tx.transactionSignature
        )
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
        (update): update is {
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
};

export type TransactionItem = Awaited<
  ReturnType<typeof transactionService.listByToken>
>[number];
