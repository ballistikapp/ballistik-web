import { AnchorProvider, BN } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSolanaConnection } from "@/lib/solana/connection";
import { mapWithConcurrency } from "@/lib/utils/async";
import { getPumpProgram } from "@/server/solana/pump-idl";
import { buildBuyTokenTransaction } from "@/server/solana/pump-transaction-builders";
import { sellTokensWithNewIdl } from "@/server/solana/pump-new-idl";
import type { VolumeBotConfigInput } from "@/server/schemas/volume-bot.schema";
import { walletService } from "@/server/services/wallet.service";

type VolumeBotWalletWithRelations = Prisma.VolumeBotWalletGetPayload<{
  include: { session: true; wallet: true };
}>;

const getTokenBalance = async (
  walletPublicKey: PublicKey,
  mintPublicKey: PublicKey
) => {
  const connection = getSolanaConnection();
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    walletPublicKey,
    { mint: mintPublicKey }
  );
  if (tokenAccounts.value.length === 0) {
    return BigInt(0);
  }
  const amount = tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount
    .amount;
  return BigInt(amount ?? "0");
};

const randomBetween = (min: number, max: number) =>
  Math.random() * (max - min) + min;

const computeNextTickAt = (config: VolumeBotConfigInput) => {
  const delaySeconds = Math.floor(
    randomBetween(config.minIntervalSeconds, config.maxIntervalSeconds)
  );
  return new Date(Date.now() + delaySeconds * 1000);
};

const selectAction = (
  strategy: VolumeBotConfigInput["strategy"],
  hasTokens: boolean
) => {
  if (strategy === "neutral") {
    return hasTokens ? "SELL" : "BUY";
  }
  if (strategy === "pump") {
    if (hasTokens && Math.random() < 0.3) {
      return "SELL";
    }
    return "BUY";
  }
  if (strategy === "dump") {
    if (hasTokens && Math.random() < 0.7) {
      return "SELL";
    }
    if (!hasTokens && Math.random() > 0.3) {
      return "WAIT";
    }
    return "BUY";
  }
  return "WAIT";
};

export const processVolumeBotWallet = async (
  volumeWallet: VolumeBotWalletWithRelations
): Promise<Date | null> => {
  const walletId = volumeWallet.id;
  const walletPk = volumeWallet.walletPublicKey.slice(0, 8);
  console.log(`[Worker] Processing wallet ${walletPk} (${walletId})`);

  const session = volumeWallet.session;
  if (session.status !== "RUNNING") {
    console.log(`[Worker] Skipping ${walletPk}: session not RUNNING (${session.status})`);
    return null;
  }

  if (session.scheduledStopAt && session.scheduledStopAt <= new Date()) {
    console.log(`[Worker] Session ${session.id} scheduled stop reached`);
    await stopVolumeBotSession(session.id);
    return null;
  }

  if (volumeWallet.status !== "ACTIVE") {
    console.log(`[Worker] Skipping ${walletPk}: wallet not ACTIVE (${volumeWallet.status})`);
    return null;
  }

  const config = session.config as VolumeBotConfigInput;
  if (!volumeWallet.nextTickAt) {
    const nextTick = computeNextTickAt(config);
    console.log(`[Worker] ${walletPk}: No nextTickAt, scheduling for ${nextTick.toISOString()}`);
    await prisma.volumeBotWallet.update({
      where: { id: volumeWallet.id },
      data: { nextTickAt: nextTick },
    });
    return nextTick;
  }
  console.log(`[Worker] ${walletPk}: Fetching balances...`);
  const connection = getSolanaConnection();
  const mintPublicKey = new PublicKey(session.tokenPublicKey);
  const walletKeypair = Keypair.fromSecretKey(
    bs58.decode(volumeWallet.wallet.privateKey)
  );

  const solBalanceLamports = await connection.getBalance(
    walletKeypair.publicKey
  );
  const tokenBalance = await getTokenBalance(
    walletKeypair.publicKey,
    mintPublicKey
  );
  const hasTokens = tokenBalance > BigInt(0);

  console.log(`[Worker] ${walletPk}: SOL=${solBalanceLamports / 1e9}, tokens=${tokenBalance}, hasTokens=${hasTokens}`);

  const action = selectAction(config.strategy, hasTokens);
  console.log(`[Worker] ${walletPk}: Selected action=${action} (strategy=${config.strategy})`);

  if (action === "WAIT") {
    const nextTick = computeNextTickAt(config);
    console.log(`[Worker] ${walletPk}: WAIT, next tick at ${nextTick.toISOString()}`);
    await prisma.volumeBotWallet.update({
      where: { id: volumeWallet.id },
      data: { nextTickAt: nextTick },
    });
    return nextTick;
  }

  let signature: string | null = null;
  let tradeAmountSol = 0;
  let tokenAmount = BigInt(0);

  try {
    if (action === "BUY") {
      tradeAmountSol = randomBetween(
        config.minTradeAmountSol,
        config.maxTradeAmountSol
      );
      const feeBufferLamports = 2_000_000;
      const requiredLamports = tradeAmountSol * 1_000_000_000 + feeBufferLamports;
      console.log(`[Worker] ${walletPk}: BUY ${tradeAmountSol} SOL, required=${requiredLamports / 1e9}, have=${solBalanceLamports / 1e9}`);

      if (solBalanceLamports < requiredLamports) {
        console.log(`[Worker] ${walletPk}: Insufficient balance, skipping`);
        const nextTick = computeNextTickAt(config);
        await prisma.volumeBotWallet.update({
          where: { id: volumeWallet.id },
          data: { nextTickAt: nextTick },
        });
        return nextTick;
      }

      const buyLamports = BigInt(Math.floor(tradeAmountSol * 1_000_000_000));
      console.log(`[Worker] ${walletPk}: Building buy tx for ${buyLamports} lamports`);
      const buyTx = await buildBuyTokenTransaction(
        walletKeypair,
        mintPublicKey,
        buyLamports
      );
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      buyTx.recentBlockhash = blockhash;
      buyTx.lastValidBlockHeight = lastValidBlockHeight;
      buyTx.feePayer = walletKeypair.publicKey;
      console.log(`[Worker] ${walletPk}: Sending buy tx...`);
      signature = await sendAndConfirmTransaction(connection, buyTx, [
        walletKeypair,
      ]);
      console.log(`[Worker] ${walletPk}: Buy tx confirmed: ${signature}`);
    } else {
      tokenAmount =
        (tokenBalance * BigInt(Math.floor(config.sellRatio * 100))) / BigInt(100);
      console.log(`[Worker] ${walletPk}: SELL ${tokenAmount} tokens (${config.sellRatio * 100}% of ${tokenBalance})`);

      if (tokenAmount <= BigInt(0)) {
        console.log(`[Worker] ${walletPk}: No tokens to sell, skipping`);
        const nextTick = computeNextTickAt(config);
        await prisma.volumeBotWallet.update({
          where: { id: volumeWallet.id },
          data: { nextTickAt: nextTick },
        });
        return nextTick;
      }
      const provider = new AnchorProvider(
        connection,
        new NodeWallet(walletKeypair),
        { commitment: "finalized" }
      );
      const program = getPumpProgram(provider);
      console.log(`[Worker] ${walletPk}: Building sell tx...`);
      const sellTx = await sellTokensWithNewIdl(
        program,
        walletKeypair,
        mintPublicKey,
        new BN(tokenAmount.toString()),
        new BN(0)
      );
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      sellTx.recentBlockhash = blockhash;
      sellTx.lastValidBlockHeight = lastValidBlockHeight;
      sellTx.feePayer = walletKeypair.publicKey;
      console.log(`[Worker] ${walletPk}: Sending sell tx...`);
      signature = await sendAndConfirmTransaction(connection, sellTx, [
        walletKeypair,
      ]);
      console.log(`[Worker] ${walletPk}: Sell tx confirmed: ${signature}`);
    }

    console.log(`[Worker] ${walletPk}: Updating balances after trade...`);
    const updatedSolLamports = await connection.getBalance(
      walletKeypair.publicKey
    );
    const updatedTokenBalance = await getTokenBalance(
      walletKeypair.publicKey,
      mintPublicKey
    );
    const solDelta =
      (updatedSolLamports - solBalanceLamports) / 1_000_000_000;
    const now = new Date();
    const nextTick = computeNextTickAt(config);

    console.log(`[Worker] ${walletPk}: SOL delta=${solDelta}, new SOL=${updatedSolLamports / 1e9}, new tokens=${updatedTokenBalance}`);
    console.log(`[Worker] ${walletPk}: Next tick at ${nextTick.toISOString()}`);

    await prisma.volumeBotWallet.update({
      where: { id: volumeWallet.id },
      data: {
        solBalance: updatedSolLamports / 1_000_000_000,
        tokenBalance: Number(updatedTokenBalance) / 1_000_000,
        tradesExecuted: { increment: 1 },
        lastTradeAt: now,
        nextTickAt: nextTick,
      },
    });

    await prisma.volumeBotSession.update({
      where: { id: session.id },
      data: {
        totalTrades: { increment: 1 },
        totalVolumeUsd: {
          increment: action === "BUY" ? tradeAmountSol : Math.abs(solDelta),
        },
        runtimeSeconds: session.startedAt
          ? Math.floor((Date.now() - session.startedAt.getTime()) / 1000)
          : 0,
        lastTickAt: now,
      },
    });

    await prisma.volumeBotLog.create({
      data: {
        sessionId: session.id,
        level: "TRADE",
        type: action.toLowerCase(),
        message: "Trade executed",
        walletPublicKey: volumeWallet.walletPublicKey,
        signature,
        data: {
          tradeAmountSol,
          tokenAmount: tokenAmount.toString(),
        },
      },
    });
    console.log(`[Worker] ${walletPk}: Trade complete!`);
    return nextTick;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Worker] ${walletPk}: ERROR - ${message}`);
    if (error instanceof Error && error.stack) {
      console.error(`[Worker] ${walletPk}: Stack:`, error.stack);
    }
    await prisma.volumeBotLog.create({
      data: {
        sessionId: session.id,
        level: "ERROR",
        type: "tick",
        message,
        walletPublicKey: volumeWallet.walletPublicKey,
      },
    });
    const nextTick = computeNextTickAt(config);
    await prisma.volumeBotWallet.update({
      where: { id: volumeWallet.id },
      data: { nextTickAt: nextTick },
    });
    return nextTick;
  }
};

export const stopVolumeBotSession = async (sessionId: string) => {
  console.log(`[Worker] stopVolumeBotSession called for ${sessionId}`);
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: sessionId },
  });
  if (!session || ["STOPPED", "FAILED"].includes(session.status)) {
    console.log(`[Worker] Session ${sessionId} not found or already stopped/failed`);
    return;
  }
  console.log(`[Worker] Stopping session ${sessionId}, status=${session.status}`);

  const config = session.config as VolumeBotConfigInput;
  await prisma.volumeBotSession.update({
    where: { id: session.id },
    data: { status: "STOPPING" },
  });

  try {
    const wallets = await prisma.volumeBotWallet.findMany({
      where: { sessionId: session.id },
      include: { wallet: true },
    });

    const connection = getSolanaConnection();
    const mintPublicKey = new PublicKey(session.tokenPublicKey);

    if (config.sellOnStop) {
      await mapWithConcurrency(wallets, 3, async (volumeWallet) => {
        const walletKeypair = Keypair.fromSecretKey(
          bs58.decode(volumeWallet.wallet.privateKey)
        );
        const tokenBalance = await getTokenBalance(
          walletKeypair.publicKey,
          mintPublicKey
        );
        if (tokenBalance <= BigInt(0)) {
          return;
        }
        const provider = new AnchorProvider(
          connection,
          new NodeWallet(walletKeypair),
          { commitment: "finalized" }
        );
        const program = getPumpProgram(provider);
        const sellTx = await sellTokensWithNewIdl(
          program,
          walletKeypair,
          mintPublicKey,
          new BN(tokenBalance.toString()),
          new BN(0)
        );
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        sellTx.recentBlockhash = blockhash;
        sellTx.lastValidBlockHeight = lastValidBlockHeight;
        sellTx.feePayer = walletKeypair.publicKey;
        await sendAndConfirmTransaction(connection, sellTx, [walletKeypair]);
      });
    }

    const walletPublicKeys = wallets.map((wallet) => wallet.walletPublicKey);
    const reclaimResults = await walletService.returnSolToMainWallet(
      session.tokenPublicKey,
      session.userId,
      walletPublicKeys,
      undefined,
      true
    );

    const now = new Date();
    await prisma.$transaction(
      reclaimResults.map((result) =>
        prisma.volumeBotWallet.updateMany({
          where: { sessionId: session.id, walletPublicKey: result.publicKey },
          data: {
            status: result.signature ? "RECLAIMED" : undefined,
            reclaimedAt: result.signature ? now : undefined,
            reclaimTxSignature: result.signature ?? undefined,
          },
        })
      )
    );

    await prisma.volumeBotSession.update({
      where: { id: session.id },
      data: { status: "STOPPED", stoppedAt: now },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.volumeBotLog.create({
      data: {
        sessionId: session.id,
        level: "ERROR",
        type: "stop",
        message,
      },
    });
    await prisma.volumeBotSession.update({
      where: { id: session.id },
      data: { status: "FAILED", stoppedAt: new Date() },
    });
  }
};

export const reclaimVolumeBotSession = async (sessionId: string) => {
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    return;
  }
  const wallets = await prisma.volumeBotWallet.findMany({
    where: { sessionId: session.id },
  });
  const walletPublicKeys = wallets.map((wallet) => wallet.walletPublicKey);
  const reclaimResults = await walletService.returnSolToMainWallet(
    session.tokenPublicKey,
    session.userId,
    walletPublicKeys,
    undefined,
    true
  );
  const now = new Date();
  await prisma.$transaction(
    reclaimResults.map((result) =>
      prisma.volumeBotWallet.updateMany({
        where: { sessionId: session.id, walletPublicKey: result.publicKey },
        data: {
          status: result.signature ? "RECLAIMED" : undefined,
          reclaimedAt: result.signature ? now : undefined,
          reclaimTxSignature: result.signature ?? undefined,
        },
      })
    )
  );
  await prisma.volumeBotLog.create({
    data: {
      sessionId: session.id,
      level: "INFO",
      type: "reclaim",
      message: "Reclaim requested",
      data: { signatures: reclaimResults.map((result) => result.signature) },
    },
  });
};

export const closeVolumeBotAccounts = async (sessionId: string) => {
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    return;
  }
  const wallets = await prisma.volumeBotWallet.findMany({
    where: { sessionId: session.id },
    include: { wallet: true },
  });
  const connection = getSolanaConnection();
  const { createCloseAccountInstruction, TOKEN_PROGRAM_ID } = await import(
    "@solana/spl-token"
  );
  await mapWithConcurrency(wallets, 2, async (volumeWallet) => {
    const walletKeypair = Keypair.fromSecretKey(
      bs58.decode(volumeWallet.wallet.privateKey)
    );
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletKeypair.publicKey,
      { programId: TOKEN_PROGRAM_ID }
    );
    await mapWithConcurrency(tokenAccounts.value, 2, async (account) => {
      const tokenAmount = account.account.data.parsed.info.tokenAmount.amount;
      if (tokenAmount !== "0") {
        return;
      }
      const closeIx = createCloseAccountInstruction(
        account.pubkey,
        walletKeypair.publicKey,
        walletKeypair.publicKey
      );
      const tx = new Transaction().add(closeIx);
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = walletKeypair.publicKey;
      await sendAndConfirmTransaction(connection, tx, [walletKeypair]);
    });
  });
};
