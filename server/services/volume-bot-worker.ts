import { AnchorProvider, BN } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { type Job } from "bullmq";
import bs58 from "bs58";
import { prisma } from "@/lib/prisma";
import { getSolanaConnection } from "@/lib/solana/connection";
import { mapWithConcurrency } from "@/lib/utils/async";
import {
  getVolumeBotControlQueue,
  getVolumeBotControlQueueEvents,
  getVolumeBotQueue,
  getVolumeBotQueueEvents,
} from "@/lib/queue/volume-bot-queues";
import { getPumpProgram } from "@/server/solana/pump-idl";
import { buildBuyTokenTransaction } from "@/server/solana/pump-transaction-builders";
import { sellTokensWithNewIdl } from "@/server/solana/pump-new-idl";
import type { VolumeBotConfigInput } from "@/server/schemas/volume-bot.schema";
import { walletService } from "@/server/services/wallet.service";

type VolumeBotJobPayload = {
  sessionId: string;
  walletPublicKey?: string;
};

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

const scheduleNextTick = async (
  sessionId: string,
  walletPublicKey: string,
  config: VolumeBotConfigInput
) => {
  const delaySeconds = Math.floor(
    randomBetween(config.minIntervalSeconds, config.maxIntervalSeconds)
  );
  const scheduleAt = Date.now() + delaySeconds * 1000;
  const queue = getVolumeBotQueue();
  await queue.add(
    "tick",
    { sessionId, walletPublicKey },
    {
      delay: delaySeconds * 1000,
      jobId: `tick:${sessionId}:${walletPublicKey}:${scheduleAt}`,
    }
  );
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

const runTick = async (job: Job<VolumeBotJobPayload>) => {
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: job.data.sessionId },
  });
  if (!session || session.status !== "RUNNING") {
    return;
  }

  const walletPublicKey = job.data.walletPublicKey;
  if (!walletPublicKey) {
    return;
  }

  if (session.scheduledStopAt && session.scheduledStopAt <= new Date()) {
    const controlQueue = getVolumeBotControlQueue();
    await controlQueue.add(
      "stop",
      { sessionId: session.id },
      { jobId: `stop:${session.id}` }
    );
    return;
  }

  const volumeWallet = await prisma.volumeBotWallet.findFirst({
    where: { sessionId: session.id, walletPublicKey },
    include: { wallet: true },
  });

  if (!volumeWallet || volumeWallet.status !== "ACTIVE") {
    return;
  }

  const config = session.config as VolumeBotConfigInput;
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

  const action = selectAction(config.strategy, hasTokens);

  if (action === "WAIT") {
    await scheduleNextTick(session.id, walletPublicKey, config);
    return;
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
      if (solBalanceLamports < tradeAmountSol * 1_000_000_000 + feeBufferLamports) {
        await scheduleNextTick(session.id, walletPublicKey, config);
        return;
      }

      const buyLamports = BigInt(Math.floor(tradeAmountSol * 1_000_000_000));
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
      signature = await sendAndConfirmTransaction(connection, buyTx, [
        walletKeypair,
      ]);
    } else {
      tokenAmount = (tokenBalance * BigInt(Math.floor(config.sellRatio * 100))) /
        BigInt(100);
      if (tokenAmount <= BigInt(0)) {
        await scheduleNextTick(session.id, walletPublicKey, config);
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
        new BN(tokenAmount.toString()),
        new BN(0)
      );
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      sellTx.recentBlockhash = blockhash;
      sellTx.lastValidBlockHeight = lastValidBlockHeight;
      sellTx.feePayer = walletKeypair.publicKey;
      signature = await sendAndConfirmTransaction(connection, sellTx, [
        walletKeypair,
      ]);
    }

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

    await prisma.volumeBotWallet.update({
      where: { id: volumeWallet.id },
      data: {
        solBalance: updatedSolLamports / 1_000_000_000,
        tokenBalance: Number(updatedTokenBalance) / 1_000_000,
        tradesExecuted: { increment: 1 },
        lastTradeAt: now,
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
        walletPublicKey,
        signature,
        data: {
          tradeAmountSol,
          tokenAmount: tokenAmount.toString(),
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.volumeBotLog.create({
      data: {
        sessionId: session.id,
        level: "ERROR",
        type: "tick",
        message,
        walletPublicKey,
      },
    });
    if (job.attemptsMade >= 2) {
      await prisma.volumeBotWallet.update({
        where: { id: volumeWallet.id },
        data: { status: "PAUSED", pauseReason: "tick_failed", pausedAt: new Date() },
      });
    }
  }

  await scheduleNextTick(session.id, walletPublicKey, config);
};

const runStart = async (job: Job<VolumeBotJobPayload>) => {
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: job.data.sessionId },
  });
  if (!session || session.status !== "RUNNING") {
    return;
  }
  const wallets = await prisma.volumeBotWallet.findMany({
    where: { sessionId: session.id },
    select: { walletPublicKey: true },
  });
  const config = session.config as VolumeBotConfigInput;
  await Promise.all(
    wallets.map((wallet) =>
      scheduleNextTick(session.id, wallet.walletPublicKey, config)
    )
  );
};

const runStop = async (job: Job<VolumeBotJobPayload>) => {
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: job.data.sessionId },
  });
  if (!session || ["STOPPED", "FAILED"].includes(session.status)) {
    return;
  }

  const config = session.config as VolumeBotConfigInput;
  await prisma.volumeBotSession.update({
    where: { id: session.id },
    data: { status: "STOPPING" },
  });

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
};

const runReclaim = async (job: Job<VolumeBotJobPayload>) => {
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: job.data.sessionId },
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

const runCloseAccounts = async (job: Job<VolumeBotJobPayload>) => {
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: job.data.sessionId },
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

export const handleVolumeBotJob = async (job: Job<VolumeBotJobPayload>) => {
  if (job.name === "start") {
    await runStart(job);
    return;
  }
  if (job.name === "tick") {
    await runTick(job);
    return;
  }
  throw new Error("Unknown volume bot job");
};

export const handleVolumeBotControlJob = async (job: Job<VolumeBotJobPayload>) => {
  if (job.name === "stop") {
    await runStop(job);
    return;
  }
  if (job.name === "reclaim") {
    await runReclaim(job);
    return;
  }
  if (job.name === "close-accounts") {
    await runCloseAccounts(job);
    return;
  }
  throw new Error("Unknown volume bot control job");
};

export const registerVolumeBotQueueEvents = async () => {
  const events = getVolumeBotQueueEvents();
  const controlEvents = getVolumeBotControlQueueEvents();

  events.on("failed", async ({ jobId, failedReason }) => {
    const queue = getVolumeBotQueue();
    const job = await queue.getJob(jobId);
    const sessionId = job?.data?.sessionId;
    if (!sessionId) {
      return;
    }
    await prisma.volumeBotLog.create({
      data: {
        sessionId,
        level: "ERROR",
        type: "queue_failed",
        message: failedReason,
      },
    });
  });

  controlEvents.on("failed", async ({ jobId, failedReason }) => {
    const queue = getVolumeBotControlQueue();
    const job = await queue.getJob(jobId);
    const sessionId = job?.data?.sessionId;
    if (!sessionId) {
      return;
    }
    await prisma.volumeBotLog.create({
      data: {
        sessionId,
        level: "ERROR",
        type: "queue_failed",
        message: failedReason,
      },
    });
  });
};
