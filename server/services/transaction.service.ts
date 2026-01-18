import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import { getSolanaConnection } from "@/lib/solana/connection";
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

  if (accountIndex === -1) {
    return null;
  }

  const preSolBalance = tx.meta.preBalances[accountIndex];
  const postSolBalance = tx.meta.postBalances[accountIndex];
  const solDiff = (postSolBalance - preSolBalance) / LAMPORTS_PER_SOL;

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
    const parsedTransactions: ParsedTransactionResult[] = [];

    for (const wallet of wallets) {
      const walletPublicKey = new PublicKey(wallet.publicKey);
      const signatures = await connection.getSignaturesForAddress(
        walletPublicKey,
        { limit: 100 }
      );

      const parsedResults = await Promise.all(
        signatures.map(async (sig) => {
          const parsed = await connection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });
          return parseTransactionForToken(
            sig.signature,
            parsed,
            wallet.publicKey,
            token.publicKey
          );
        })
      );

      parsedResults.forEach((result) => {
        if (result) {
          parsedTransactions.push(result);
        }
      });
    }

    if (parsedTransactions.length === 0) {
      return [];
    }

    const uniquePairs = new Set(
      parsedTransactions.map(
        (tx) => `${tx.walletPublicKey}:${tx.transactionSignature}`
      )
    );
    const uniqueSignatures = Array.from(
      new Set(parsedTransactions.map((tx) => tx.transactionSignature))
    );

    const existing = await prisma.transaction.findMany({
      where: {
        tokenPublicKey: token.publicKey,
        transactionSignature: { in: uniqueSignatures },
        walletPublicKey: { in: wallets.map((wallet) => wallet.publicKey) },
      },
      select: { transactionSignature: true, walletPublicKey: true },
    });

    const existingSet = new Set(
      existing.map(
        (transaction) =>
          `${transaction.walletPublicKey}:${transaction.transactionSignature}`
      )
    );

    const newTransactions = parsedTransactions.filter((transaction) => {
      const key = `${transaction.walletPublicKey}:${transaction.transactionSignature}`;
      if (!uniquePairs.has(key)) return false;
      if (existingSet.has(key)) return false;
      uniquePairs.delete(key);
      return true;
    });

    if (newTransactions.length === 0) {
      return [];
    }

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

    return newTransactions;
  },
};

export type TransactionItem = Awaited<
  ReturnType<typeof transactionService.listByToken>
>[number];
