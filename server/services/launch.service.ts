import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { AppError, isAppError } from "@/server/errors";
import { logger } from "@/lib/logger";
import type { LaunchTokenInput } from "@/server/schemas/launch.schema";
import { getSolanaConnection } from "@/lib/solana/connection";
import { AnchorProvider } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { PumpFunSDK, type CreateTokenMetadata } from "pumpdotfun-sdk";
import { createAndBuyInBundle } from "@/server/solana/bundle-create-and-buy";

const SLIPPAGE_BASIS_POINTS = BigInt(10000);
const MIN_BUY_AMOUNT_SOL = 0.003;
const FUNDING_BUFFER_LAMPORTS = 4_000_000;
const CREATE_FEE_BUFFER_LAMPORTS = 2_000_000;
const TRANSFER_FEE_BUFFER_LAMPORTS = 10_000;
const FUNDING_BATCH_SIZE = 6;
const LAUNCH_STALE_MS = 15 * 60 * 1000;
const LAUNCH_STALE_ERROR =
  "Launch stalled. Please recover funds and try again.";
const MINT_CONFIRM_TIMEOUT_MS = 120_000;
const MINT_CONFIRM_INTERVAL_MS = 2_000;
const MIN_CREATOR_BALANCE_LAMPORTS = BigInt(20_000_000);

type LaunchLogLevel = "INFO" | "WARN" | "ERROR" | "STEP";
type LaunchRecord = Prisma.LaunchGetPayload<{}>;

function toLamports(amount: number) {
  return BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
}

function lamportsToSol(lamports: bigint) {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

type LaunchRecoveryData = {
  mainWalletPublicKey: string;
  devWalletPublicKey: string;
  usesMainWalletAsDev: boolean;
  devWalletManaged: boolean;
  bundlerWallets: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return "";
}

function getErrorStatusCode(error: unknown) {
  if (isRecord(error)) {
    const status = error.status ?? error.statusCode;
    if (typeof status === "number") {
      return status;
    }
    if (typeof status === "string") {
      const parsed = Number(status);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  if (error instanceof Error) {
    const candidate = error as {
      status?: number;
      statusCode?: number;
      code?: number | string;
    };
    if (typeof candidate.status === "number") {
      return candidate.status;
    }
    if (typeof candidate.statusCode === "number") {
      return candidate.statusCode;
    }
    if (typeof candidate.code === "number") {
      return candidate.code;
    }
    if (typeof candidate.code === "string") {
      const parsed = Number(candidate.code);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function isRateLimitError(error: unknown, message: string) {
  const statusCode = getErrorStatusCode(error);
  if (statusCode === 429) {
    return true;
  }
  const normalized = message.toLowerCase();
  return (
    normalized.includes("too many requests") ||
    normalized.includes("rate limit") ||
    normalized.includes("429")
  );
}

function resolveLaunchClientMessage(error: unknown, message: string) {
  if (isRateLimitError(error, message)) {
    return "RPC rate limit reached. Please try again shortly.";
  }
  if (process.env.NODE_ENV !== "production" && message) {
    return message;
  }
  return "Something went wrong during launch.";
}

function buildLaunchRecoveryData(
  input: LaunchTokenInput,
  mainWalletPublicKey: string,
  devWalletPublicKey: string,
  bundlerWalletKeypairs: Keypair[]
): LaunchRecoveryData {
  const usesMainWalletAsDev = devWalletPublicKey === mainWalletPublicKey;
  return {
    mainWalletPublicKey,
    devWalletPublicKey,
    usesMainWalletAsDev,
    devWalletManaged: input.devWalletOption === "generate",
    bundlerWallets: bundlerWalletKeypairs.map((wallet) =>
      wallet.publicKey.toBase58()
    ),
  };
}

function parseLaunchRecoveryObject(
  value: Record<string, unknown>
): LaunchRecoveryData | null {
  const mainWalletPublicKey =
    typeof value.mainWalletPublicKey === "string" ? value.mainWalletPublicKey : "";
  const devWalletPublicKey =
    typeof value.devWalletPublicKey === "string" ? value.devWalletPublicKey : "";
  const bundlerWallets = Array.isArray(value.bundlerWallets)
    ? value.bundlerWallets.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
  const usesMainWalletAsDev =
    value.usesMainWalletAsDev === true ||
    (Boolean(mainWalletPublicKey) &&
      Boolean(devWalletPublicKey) &&
      mainWalletPublicKey === devWalletPublicKey);
  const devWalletManaged = value.devWalletManaged === true;
  if (!devWalletPublicKey && bundlerWallets.length === 0) {
    return null;
  }
  return {
    mainWalletPublicKey,
    devWalletPublicKey,
    usesMainWalletAsDev,
    devWalletManaged,
    bundlerWallets,
  };
}

function parseLaunchRecoveryData(result: Prisma.JsonValue | null) {
  if (!result || !isRecord(result)) {
    return null;
  }
  const recoveryValue = isRecord(result.recovery) ? result.recovery : null;
  const parsedRecovery = recoveryValue
    ? parseLaunchRecoveryObject(recoveryValue)
    : null;
  if (parsedRecovery) {
    return parsedRecovery;
  }
  return parseLaunchRecoveryObject(result);
}

async function setLaunchRecovery(launchId: string, recovery: LaunchRecoveryData) {
  await prisma.launch.update({
    where: { id: launchId },
    data: {
      result: { recovery },
    },
  });
}

function buildTokenMetadata(
  input: LaunchTokenInput,
  file: File
): CreateTokenMetadata {
  const metadata: CreateTokenMetadata = {
    name: input.tokenName.trim(),
    symbol: normalizeSymbol(input.tokenSymbol),
    description: input.description.trim(),
    file,
  };

  if (input.twitter?.trim()) {
    metadata.twitter = input.twitter.trim();
  }
  if (input.telegram?.trim()) {
    metadata.telegram = input.telegram.trim();
  }
  if (input.website?.trim()) {
    metadata.website = input.website.trim();
  }

  return metadata;
}

async function resolveImageFile(tokenImage: string, symbol: string) {
  if (!tokenImage) {
    throw new AppError("Token image is required", 400);
  }

  if (tokenImage.startsWith("data:image")) {
    const [header, data] = tokenImage.split(",");
    const mimeMatch = header.match(/:(.*?);/);
    if (!mimeMatch) {
      throw new AppError("Invalid image format", 400);
    }
    const mime = mimeMatch[1];
    const buffer = Buffer.from(data, "base64");
    return new File([buffer], `${symbol}.png`, { type: mime });
  }

  const response = await fetch(tokenImage);
  if (!response.ok) {
    throw new AppError("Failed to fetch token image", 400);
  }
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "image/png";
  return new File([arrayBuffer], `${symbol}.png`, { type: contentType });
}

async function createPumpSdk(creator: Keypair) {
  const wallet = new NodeWallet(creator);
  const provider = new AnchorProvider(getSolanaConnection(), wallet, {
    commitment: "finalized",
  });
  return new PumpFunSDK(provider);
}

async function appendLog(
  launchId: string,
  level: LaunchLogLevel,
  message: string,
  step?: string,
  data?: Prisma.InputJsonValue
) {
  await prisma.launchLog.create({
    data: {
      launchId,
      level,
      message,
      step,
      data,
    },
  });
  const context: Record<string, unknown> = {
    launchId,
    step,
    launchLevel: level,
  };
  if (data && typeof data === "object" && !Array.isArray(data)) {
    Object.assign(context, data as Record<string, unknown>);
  }
  if (level === "ERROR") {
    logger.error(message, context);
  } else if (level === "WARN") {
    logger.warn(message, context);
  } else {
    logger.info(message, context);
  }
}

async function updateProgress(
  launchId: string,
  progress: number,
  currentStep?: string
) {
  await prisma.launch.update({
    where: { id: launchId },
    data: {
      progress,
      currentStep,
    },
  });
}

async function markLaunchStaleIfNeeded<T extends LaunchRecord>(launch: T) {
  if (launch.status !== "PENDING" && launch.status !== "RUNNING") {
    return launch;
  }
  const lastActivityAt =
    launch.updatedAt ?? launch.startedAt ?? launch.createdAt;
  const lastActivityMs = lastActivityAt?.getTime?.() ?? 0;
  if (!lastActivityMs || Date.now() - lastActivityMs < LAUNCH_STALE_MS) {
    return launch;
  }
  const completedAt = new Date();
  const errorMessage = launch.errorMessage ?? LAUNCH_STALE_ERROR;
  await prisma.launch.update({
    where: { id: launch.id },
    data: {
      status: "FAILED",
      errorMessage,
      completedAt,
    },
  });
  return {
    ...launch,
    status: "FAILED",
    errorMessage,
    completedAt,
    updatedAt: completedAt,
  };
}

async function isCancelRequested(launchId: string) {
  const launch = await prisma.launch.findUnique({
    where: { id: launchId },
    select: { cancelRequestedAt: true },
  });
  return Boolean(launch?.cancelRequestedAt);
}

async function reserveVanityMint(userId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await prisma.vanityMint.findFirst({
      where: {
        reservedAt: null,
        usedAt: null,
        tokenPublicKey: null,
      },
      select: { id: true, publicKey: true, privateKey: true },
    });

    if (!candidate) {
      return null;
    }

    const lock = await prisma.vanityMint.updateMany({
      where: {
        id: candidate.id,
        reservedAt: null,
        usedAt: null,
        tokenPublicKey: null,
      },
      data: {
        reservedAt: new Date(),
        userId,
      },
    });

    if (lock.count === 1) {
      return candidate;
    }
  }

  return null;
}

async function releaseVanityMint(id: string) {
  await prisma.vanityMint.update({
    where: { id },
    data: { reservedAt: null, userId: null },
  });
}

async function setStep(
  launchId: string,
  progress: number,
  step: string,
  message: string
) {
  await updateProgress(launchId, progress, step);
  await appendLog(launchId, "STEP", message, step);
}

async function waitForMintAccount(mintPublicKey: string) {
  const connection = getSolanaConnection();
  const mintKey = new PublicKey(mintPublicKey);
  const startedAt = Date.now();
  let attempts = 0;

  while (Date.now() - startedAt < MINT_CONFIRM_TIMEOUT_MS) {
    attempts += 1;
    const account = await connection.getAccountInfo(mintKey, "confirmed");
    if (account) {
      return {
        attempts,
        durationMs: Date.now() - startedAt,
        owner: account.owner.toBase58(),
        lamports: account.lamports,
        dataLength: account.data.length,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, MINT_CONFIRM_INTERVAL_MS));
  }

  throw new AppError(
    "Token mint not found on chain. The create transaction may have failed or the RPC cluster does not match pump.fun.",
    500
  );
}

function keypairFromPrivateKey(privateKey: string) {
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

function requiredBuyLamports(amountSol: number, extraBufferLamports = 0) {
  if (amountSol <= 0) {
    return BigInt(0);
  }
  return (
    toLamports(amountSol) +
    BigInt(FUNDING_BUFFER_LAMPORTS + TRANSFER_FEE_BUFFER_LAMPORTS) +
    BigInt(extraBufferLamports)
  );
}

async function fundWalletsFromMain(
  launchId: string,
  mainWalletKeypair: Keypair,
  targets: { publicKey: PublicKey; requiredLamports: bigint }[],
  mainReserveLamports: bigint
) {
  const connection = getSolanaConnection();
  const startedAt = Date.now();
  const uniqueTargets = targets.filter(
    (target, index, all) =>
      all.findIndex((item) =>
        item.publicKey.equals(target.publicKey)
      ) === index
  );

  if (uniqueTargets.length === 0) {
    await appendLog(launchId, "INFO", "No wallet funding needed", "funding", {
      fundedCount: 0,
      totalLamports: "0",
      totalSol: "0.0000",
      durationMs: Date.now() - startedAt,
    });
    return { fundedCount: 0, totalLamports: BigInt(0), signatures: [] as string[] };
  }

  const [mainBalance, ...targetBalances] = await Promise.all([
    connection.getBalance(mainWalletKeypair.publicKey, "confirmed"),
    ...uniqueTargets.map((target) =>
      connection.getBalance(target.publicKey, "confirmed")
    ),
  ]);

  const fundingPlan = uniqueTargets
    .map((target, index) => {
      const currentLamports = BigInt(targetBalances[index] ?? 0);
      const topUpLamports = target.requiredLamports - currentLamports;
      return {
        publicKey: target.publicKey,
        topUpLamports,
      };
    })
    .filter((target) => target.topUpLamports > BigInt(0));

  if (fundingPlan.length === 0) {
    await appendLog(launchId, "INFO", "Funding not required", "funding", {
      fundedCount: 0,
      totalLamports: "0",
      totalSol: "0.0000",
      durationMs: Date.now() - startedAt,
    });
    return { fundedCount: 0, totalLamports: BigInt(0), signatures: [] as string[] };
  }

  const totalLamports = fundingPlan.reduce(
    (total, target) => total + target.topUpLamports,
    BigInt(0)
  );

  if (BigInt(mainBalance) < totalLamports + mainReserveLamports) {
    throw new AppError(
      `Main wallet requires ${lamportsToSol(totalLamports + mainReserveLamports).toFixed(4)} SOL to fund launch wallets`,
      400
    );
  }

  const signatures: string[] = [];
  for (let i = 0; i < fundingPlan.length; i += FUNDING_BATCH_SIZE) {
    const batch = fundingPlan.slice(i, i + FUNDING_BATCH_SIZE);
    const transaction = new Transaction();
    batch.forEach((target) => {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: mainWalletKeypair.publicKey,
          toPubkey: target.publicKey,
          lamports: Number(target.topUpLamports),
        })
      );
    });
    transaction.feePayer = mainWalletKeypair.publicKey;
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [mainWalletKeypair],
      { commitment: "confirmed" }
    );
    signatures.push(signature);
  }

  await appendLog(launchId, "INFO", "Wallets funded", "funding", {
    fundedCount: fundingPlan.length,
    totalLamports: totalLamports.toString(),
    totalSol: lamportsToSol(totalLamports).toFixed(4),
    transactions: signatures.length,
    signatures,
    reserveSol: lamportsToSol(mainReserveLamports).toFixed(4),
    durationMs: Date.now() - startedAt,
  });

  return { fundedCount: fundingPlan.length, totalLamports, signatures };
}

function validateLaunchInput(input: LaunchTokenInput) {
  const devBuyAmountSol = input.devBuyAmountSol;
  const jitoTipAmountSol = input.jitoTipAmountSol;
  const bundlerWalletCount = Math.max(
    0,
    Math.floor(input.bundlerWalletCount)
  );
  const bundlerBuyAmountSol = input.bundlerBuyAmountSol;
  const bundlerBuyVariancePercent = input.bundlerBuyVariancePercent;
  const distributionWalletMultiplier = Math.max(
    1,
    Math.floor(input.distributionWalletMultiplier)
  );

  if (devBuyAmountSol <= 0) {
    throw new AppError("Dev buy amount must be greater than 0", 400);
  }
  if (devBuyAmountSol > 0 && devBuyAmountSol < MIN_BUY_AMOUNT_SOL) {
    throw new AppError(`Dev buy must be at least ${MIN_BUY_AMOUNT_SOL} SOL`, 400);
  }
  if (bundlerBuyAmountSol > 0 && bundlerBuyAmountSol < MIN_BUY_AMOUNT_SOL) {
    throw new AppError(
      `Buy amount per wallet must be at least ${MIN_BUY_AMOUNT_SOL} SOL`,
      400
    );
  }
  if (input.bundleBuyEnabled && bundlerWalletCount > 11) {
    throw new AppError("Bundle buy supports up to 11 wallets per launch", 400);
  }

  return {
    devBuyAmountSol,
    jitoTipAmountSol,
    bundlerWalletCount,
    bundlerBuyAmountSol,
    bundlerBuyVariancePercent,
    distributionWalletMultiplier,
  };
}

async function loadUserWithMainWallet(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { mainWallet: true },
  });

  if (!user?.mainWallet) {
    throw new AppError("Main wallet not found", 400);
  }

  return user;
}

async function resolveDevWallet(
  input: LaunchTokenInput,
  userId: string,
  mainWalletKeypair: Keypair,
  mainWalletPublicKey: string
) {
  let devWalletKeypair = mainWalletKeypair;
  let devWalletPublicKey = mainWalletPublicKey;

  if (input.devWalletOption === "import") {
    if (!input.importedDevWalletKey?.trim()) {
      throw new AppError("Dev wallet private key is required", 400);
    }
    devWalletKeypair = keypairFromPrivateKey(input.importedDevWalletKey.trim());
    devWalletPublicKey = devWalletKeypair.publicKey.toBase58();
    const existingDevWallet = await prisma.wallet.findUnique({
      where: { publicKey: devWalletPublicKey },
    });
    if (!existingDevWallet) {
      await prisma.wallet.create({
        data: {
          publicKey: devWalletPublicKey,
          privateKey: input.importedDevWalletKey.trim(),
          type: "DEV",
          userId,
          isImported: true,
        },
      });
    }
  }

  if (input.devWalletOption === "generate") {
    devWalletKeypair = Keypair.generate();
    devWalletPublicKey = devWalletKeypair.publicKey.toBase58();
    await prisma.wallet.create({
      data: {
        publicKey: devWalletPublicKey,
        privateKey: bs58.encode(devWalletKeypair.secretKey),
        type: "DEV",
        userId,
      },
    });
  }

  return { devWalletKeypair, devWalletPublicKey };
}

async function ensureBundlerWallets(userId: string, walletCount: number) {
  const bundlerWalletKeypairs: Keypair[] = [];
  if (walletCount <= 0) {
    return bundlerWalletKeypairs;
  }
  for (let i = 0; i < walletCount; i += 1) {
    bundlerWalletKeypairs.push(Keypair.generate());
  }
  await prisma.wallet.createMany({
    data: bundlerWalletKeypairs.map((wallet) => ({
      publicKey: wallet.publicKey.toBase58(),
      privateKey: bs58.encode(wallet.secretKey),
      type: "BUNDLER",
      userId,
    })),
  });
  return bundlerWalletKeypairs;
}

async function cancelLaunchIfRequested(
  launchId: string,
  reservedVanityId?: string | null
) {
  if (!(await isCancelRequested(launchId))) {
    return false;
  }
  await appendLog(launchId, "WARN", "Launch canceled", "cancel");
  await prisma.launch.update({
    where: { id: launchId },
    data: { status: "CANCELED", completedAt: new Date() },
  });
  if (reservedVanityId) {
    await releaseVanityMint(reservedVanityId);
  }
  return true;
}

async function reserveMintIfRequested(
  launchId: string,
  userId: string,
  vanityRequested: boolean
) {
  if (!vanityRequested) {
    return { mintKeypair: Keypair.generate(), reservedVanityId: null };
  }
  const reserved = await reserveVanityMint(userId);
  if (reserved) {
    await appendLog(launchId, "INFO", "Using vanity mint", "mint", {
      publicKey: reserved.publicKey,
    });
    return {
      mintKeypair: keypairFromPrivateKey(reserved.privateKey),
      reservedVanityId: reserved.id,
    };
  }
  await appendLog(
    launchId,
    "WARN",
    "No vanity mint available, using random",
    "mint"
  );
  return { mintKeypair: Keypair.generate(), reservedVanityId: null };
}

function buildBundlerBuyTarget(
  wallet: Keypair,
  bundlerBuyAmountSol: number,
  bundlerBuyVariancePercent: number
) {
  const variance = bundlerBuyAmountSol * (bundlerBuyVariancePercent / 100);
  const amount = Math.max(
    0,
    bundlerBuyAmountSol + (Math.random() * 2 - 1) * variance
  );
  return { wallet, amount, amountLamports: toLamports(amount) };
}

function buildBundlerBuyTargets(
  wallets: Keypair[],
  bundlerBuyAmountSol: number,
  bundlerBuyVariancePercent: number
) {
  return wallets
    .map((wallet) =>
      buildBundlerBuyTarget(
        wallet,
        bundlerBuyAmountSol,
        bundlerBuyVariancePercent
      )
    )
    .filter((target) => target.amountLamports > BigInt(0));
}

async function persistTokenAndWallets(
  input: LaunchTokenInput,
  userId: string,
  mintPublicKey: string,
  mintPrivateKey: string,
  devWalletPublicKey: string,
  bundlerWalletKeypairs: Keypair[],
  reservedVanityId: string | null,
  distributionWalletMultiplier: number,
  launchId: string
) {
  let distributionWalletCount = 0;
  const token = await prisma.$transaction(
    async (tx) => {
      const createdToken = await tx.token.create({
        data: {
          publicKey: mintPublicKey,
          privateKey: mintPrivateKey,
          name: input.tokenName.trim(),
          symbol: normalizeSymbol(input.tokenSymbol),
          description: input.description.trim(),
          imageUrl: input.tokenImage || null,
          twitterUrl: input.twitter?.trim() || null,
          telegramUrl: input.telegram?.trim() || null,
          websiteUrl: input.website?.trim() || null,
          userId,
        },
      });

      await tx.tokenDevWallet.create({
        data: {
          tokenPublicKey: createdToken.publicKey,
          walletPublicKey: devWalletPublicKey,
        },
      });

      if (bundlerWalletKeypairs.length > 0) {
        await tx.wallet.updateMany({
          where: {
            publicKey: {
              in: bundlerWalletKeypairs.map((wallet) =>
                wallet.publicKey.toBase58()
              ),
            },
          },
          data: {
            tokenPublicKey: createdToken.publicKey,
          },
        });
      }

      if (reservedVanityId) {
        await tx.vanityMint.update({
          where: { id: reservedVanityId },
          data: {
            usedAt: new Date(),
            tokenPublicKey: createdToken.publicKey,
          },
        });
      }

      if (distributionWalletMultiplier > 1) {
        const distributionWallets: Keypair[] = [];
        const total =
          bundlerWalletKeypairs.length * (distributionWalletMultiplier - 1);
        for (let i = 0; i < total; i += 1) {
          distributionWallets.push(Keypair.generate());
        }
        if (distributionWallets.length > 0) {
          distributionWalletCount = distributionWallets.length;
          await tx.wallet.createMany({
            data: distributionWallets.map((wallet) => ({
              publicKey: wallet.publicKey.toBase58(),
              privateKey: bs58.encode(wallet.secretKey),
              type: "DISTRIBUTION",
              userId,
              tokenPublicKey: createdToken.publicKey,
            })),
          });
        }
      }

      return createdToken;
    },
    {
      maxWait: 10000,
      timeout: 20000,
    }
  );

  return { token, distributionWalletCount };
}

async function finalizeLaunch(
  launchId: string,
  tokenPublicKey: string,
  devWalletPublicKey: string,
  mainWalletPublicKey: string,
  bundlerWalletKeypairs: Keypair[],
  recovery: LaunchRecoveryData,
  jitoTipAmountSol: number,
  durationMs?: number
) {
  const finalStatus = (await isCancelRequested(launchId))
    ? "CANCELED"
    : "SUCCEEDED";

  await prisma.launch.update({
    where: { id: launchId },
    data: {
      status: finalStatus,
      progress: 100,
      completedAt: new Date(),
      tokenPublicKey,
      result: {
        tokenPublicKey,
        devWalletPublicKey,
        mainWalletPublicKey,
        bundlerWallets: bundlerWalletKeypairs.map((wallet) =>
          wallet.publicKey.toBase58()
        ),
        jitoTipAmountSol,
        recovery,
      },
    },
  });

  const completionData: Prisma.InputJsonObject = {
    status: finalStatus,
    tokenPublicKey,
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
  await appendLog(launchId, "INFO", "Launch complete", "complete", completionData);
}

async function loadLaunchRecoveryInfo(launchId: string, userId: string) {
  const launch = await prisma.launch.findFirst({
    where: { id: launchId, userId },
  });

  if (!launch) {
    throw new AppError("Launch not found", 404);
  }

  const resolvedLaunch = await markLaunchStaleIfNeeded(launch);
  if (resolvedLaunch.status === "PENDING" || resolvedLaunch.status === "RUNNING") {
    throw new AppError("Launch is still in progress", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mainWallet: { select: { publicKey: true } } },
  });
  const mainWalletPublicKey = user?.mainWallet?.publicKey;
  if (!mainWalletPublicKey) {
    throw new AppError("Main wallet not found", 400);
  }

  const recovery = parseLaunchRecoveryData(resolvedLaunch.result);
  if (recovery) {
    const walletKeys = new Set<string>();
    recovery.bundlerWallets.forEach((key) => walletKeys.add(key));
    if (
      recovery.devWalletManaged &&
      recovery.devWalletPublicKey &&
      recovery.devWalletPublicKey !== mainWalletPublicKey
    ) {
      walletKeys.add(recovery.devWalletPublicKey);
    }
    const excludedDevWalletPublicKey =
      !recovery.devWalletManaged &&
      recovery.devWalletPublicKey &&
      recovery.devWalletPublicKey !== mainWalletPublicKey
        ? recovery.devWalletPublicKey
        : null;

    return {
      launch: resolvedLaunch,
      source: "result" as const,
      mainWalletPublicKey,
      walletPublicKeys: Array.from(walletKeys),
      excludedDevWalletPublicKey,
    };
  }

  const fallbackWallets = await prisma.wallet.findMany({
    where: {
      userId,
      tokenPublicKey: null,
      OR: [
        { type: "BUNDLER" },
        { type: "DEV", isImported: false, devWalletTokens: { none: {} } },
      ],
    },
    select: { publicKey: true },
  });

  return {
    launch: resolvedLaunch,
    source: "fallback" as const,
    mainWalletPublicKey,
    walletPublicKeys: fallbackWallets.map((wallet) => wallet.publicKey),
    excludedDevWalletPublicKey: null,
  };
}

export const launchService = {
  async startLaunch(input: LaunchTokenInput, userId: string) {
    const launch = await prisma.launch.create({
      data: {
        userId,
        status: "PENDING",
        input,
      },
    });

    appendLog(launch.id, "STEP", "Launch queued", "queue");
    void this.runLaunchJob(launch.id);

    return { launchId: launch.id };
  },

  async getLaunchStatus(launchId: string, userId: string) {
    const launch = await prisma.launch.findFirst({
      where: { id: launchId, userId },
      include: {
        logs: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!launch) {
      throw new AppError("Launch not found", 404);
    }

    return await markLaunchStaleIfNeeded(launch);
  },

  async getActiveLaunch(userId: string) {
    const launch = await prisma.launch.findFirst({
      where: {
        userId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
      include: {
        logs: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!launch) {
      return null;
    }
    return await markLaunchStaleIfNeeded(launch);
  },
  async getRecoveryWallets(launchId: string, userId: string) {
    const {
      launch,
      source,
      mainWalletPublicKey,
      walletPublicKeys,
      excludedDevWalletPublicKey,
    } = await loadLaunchRecoveryInfo(launchId, userId);

    if (launch.status !== "FAILED" && launch.status !== "CANCELED") {
      throw new AppError("Launch is not eligible for recovery", 400);
    }

    if (walletPublicKeys.length === 0) {
      return {
        source,
        mainWalletPublicKey,
        wallets: [],
        excludedDevWalletPublicKey,
      };
    }

    const walletRecords = await prisma.wallet.findMany({
      where: { userId, publicKey: { in: walletPublicKeys } },
      select: { publicKey: true, type: true, balanceRefreshedAt: true },
    });
    const walletMap = new Map(
      walletRecords.map((wallet) => [wallet.publicKey, wallet])
    );
    const orderedWallets = walletPublicKeys
      .map((publicKey) => walletMap.get(publicKey))
      .filter(
        (wallet): wallet is NonNullable<typeof walletRecords[number]> =>
          Boolean(wallet)
      );

    const connection = getSolanaConnection();
    const now = new Date();
    const balances = await Promise.all(
      orderedWallets.map(async (wallet) => {
        const walletPublicKey = new PublicKey(wallet.publicKey);
        const balanceLamports = await connection.getBalance(walletPublicKey);
        return {
          publicKey: wallet.publicKey,
          type: wallet.type,
          balanceSol: balanceLamports / LAMPORTS_PER_SOL,
          balanceRefreshedAt: now,
        };
      })
    );

    if (balances.length > 0) {
      await prisma.$transaction(
        balances.map((balance) =>
          prisma.wallet.update({
            where: { publicKey: balance.publicKey },
            data: {
              balanceSol: balance.balanceSol,
              balanceRefreshedAt: balance.balanceRefreshedAt,
            },
          })
        )
      );
    }

    return {
      source,
      mainWalletPublicKey,
      wallets: balances,
      excludedDevWalletPublicKey,
    };
  },
  async recoverSol(
    launchId: string,
    userId: string,
    walletPublicKeys?: string[]
  ) {
    const { launch, mainWalletPublicKey, walletPublicKeys: recoveryWallets } =
      await loadLaunchRecoveryInfo(launchId, userId);

    if (launch.status !== "FAILED" && launch.status !== "CANCELED") {
      throw new AppError("Launch is not eligible for recovery", 400);
    }

    const targetWallets = walletPublicKeys?.length
      ? walletPublicKeys.filter((key) => recoveryWallets.includes(key))
      : recoveryWallets;

    if (targetWallets.length === 0) {
      throw new AppError("No recovery wallets available", 400);
    }

    const wallets = await prisma.wallet.findMany({
      where: { userId, publicKey: { in: targetWallets } },
      select: { publicKey: true, privateKey: true },
    });

    const connection = getSolanaConnection();
    const mainPublicKey = new PublicKey(mainWalletPublicKey);
    const results: {
      publicKey: string;
      status: "returned" | "skipped" | "failed";
      signature?: string;
      amountSol?: number;
      error?: string;
    }[] = [];

    for (const wallet of wallets) {
      const walletPublicKey = new PublicKey(wallet.publicKey);
      const balanceLamports = await connection.getBalance(walletPublicKey);
      const lamportsToSend =
        balanceLamports - TRANSFER_FEE_BUFFER_LAMPORTS;
      if (lamportsToSend <= 0) {
        results.push({
          publicKey: wallet.publicKey,
          status: "skipped",
          error: "Insufficient balance",
        });
        continue;
      }

      try {
        const sender = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: sender.publicKey,
            toPubkey: mainPublicKey,
            lamports: lamportsToSend,
          })
        );
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [sender],
          { commitment: "confirmed" }
        );
        results.push({
          publicKey: wallet.publicKey,
          status: "returned",
          signature,
          amountSol: lamportsToSol(BigInt(lamportsToSend)),
        });
      } catch (error) {
        results.push({
          publicKey: wallet.publicKey,
          status: "failed",
          error: error instanceof Error ? error.message : "Return failed",
        });
      }
    }

    return {
      mainWalletPublicKey,
      results,
    };
  },

  async cancelLaunch(launchId: string, userId: string) {
    const launch = await prisma.launch.findFirst({
      where: { id: launchId, userId },
    });

    if (!launch) {
      throw new AppError("Launch not found", 404);
    }

    if (
      launch.status === "SUCCEEDED" ||
      launch.status === "FAILED" ||
      launch.status === "CANCELED"
    ) {
      return launch;
    }

    if (launch.status === "PENDING") {
      const updated = await prisma.launch.update({
        where: { id: launchId },
        data: {
          status: "CANCELED",
          cancelRequestedAt: new Date(),
          completedAt: new Date(),
        },
      });
      await appendLog(
        launchId,
        "WARN",
        "Launch canceled before start",
        "cancel"
      );
      return updated;
    }

    const updated = await prisma.launch.update({
      where: { id: launchId },
      data: {
        cancelRequestedAt: new Date(),
      },
    });
    await appendLog(launchId, "WARN", "Cancel requested", "cancel");
    return updated;
  },

  async runLaunchJob(launchId: string) {
    const launch = await prisma.launch.findUnique({
      where: { id: launchId },
    });

    if (!launch) {
      return;
    }

    if (launch.status !== "PENDING") {
      return;
    }

    await prisma.launch.update({
      where: { id: launchId },
      data: { status: "RUNNING", startedAt: new Date(), progress: 2 },
    });

    const launchStartedAt = Date.now();
    const input = launch.input as LaunchTokenInput;
    let reservedVanityId: string | null = null;
    let recoveryData: LaunchRecoveryData | null = null;

    try {
      const tokenImageSource = input.tokenImage
        ? input.tokenImage.startsWith("data:image")
          ? "inline"
          : "url"
        : "missing";
      await appendLog(launchId, "INFO", "Launch started", "start", {
        tokenName: input.tokenName.trim(),
        tokenSymbol: normalizeSymbol(input.tokenSymbol),
        bundleBuyEnabled: input.bundleBuyEnabled,
        devWalletOption: input.devWalletOption,
        vanityMint: input.vanityMint,
        devBuyAmountSol: input.devBuyAmountSol,
        bundlerWalletCount: input.bundlerWalletCount,
        bundlerBuyAmountSol: input.bundlerBuyAmountSol,
        bundlerBuyVariancePercent: input.bundlerBuyVariancePercent,
        distributionWalletMultiplier: input.distributionWalletMultiplier,
        jitoTipAmountSol: input.jitoTipAmountSol,
        tokenImageSource,
        hasTwitter: Boolean(input.twitter?.trim()),
        hasTelegram: Boolean(input.telegram?.trim()),
        hasWebsite: Boolean(input.website?.trim()),
      });
      await appendLog(launchId, "STEP", "Validating input", "validate");
      const validationStartedAt = Date.now();
      const {
        devBuyAmountSol,
        jitoTipAmountSol,
        bundlerWalletCount,
        bundlerBuyAmountSol,
        bundlerBuyVariancePercent,
        distributionWalletMultiplier,
      } = validateLaunchInput(input);
      await appendLog(launchId, "INFO", "Input validated", "validate", {
        bundleBuyEnabled: input.bundleBuyEnabled,
        bundlerWalletCount,
        devBuyAmountSol,
        bundlerBuyAmountSol,
        bundlerBuyVariancePercent,
        distributionWalletMultiplier,
        durationMs: Date.now() - validationStartedAt,
      });

      await setStep(launchId, 6, "wallets", "Loading wallets");

      const walletsStartedAt = Date.now();
      const user = await loadUserWithMainWallet(launch.userId);
      const mainWalletKeypair = keypairFromPrivateKey(
        user.mainWallet.privateKey
      );
      const { devWalletKeypair, devWalletPublicKey } = await resolveDevWallet(
        input,
        user.id,
        mainWalletKeypair,
        user.mainWallet.publicKey
      );
      const bundlerWalletKeypairs =
        input.bundleBuyEnabled && bundlerWalletCount > 0
          ? await ensureBundlerWallets(user.id, bundlerWalletCount)
          : [];
      await appendLog(launchId, "INFO", "Wallets prepared", "wallets", {
        mainWalletPublicKey: user.mainWallet.publicKey,
        devWalletPublicKey,
        usesMainWalletAsDev: devWalletPublicKey === user.mainWallet.publicKey,
        devWalletOption: input.devWalletOption,
        bundlerWallets: bundlerWalletKeypairs.length,
        bundleBuyEnabled: input.bundleBuyEnabled,
        durationMs: Date.now() - walletsStartedAt,
      });
      recoveryData = buildLaunchRecoveryData(
        input,
        user.mainWallet.publicKey,
        devWalletPublicKey,
        bundlerWalletKeypairs
      );
      await setLaunchRecovery(launchId, recoveryData);

      if (await cancelLaunchIfRequested(launchId)) {
        return;
      }

      await setStep(launchId, 12, "funding", "Funding wallets");
      const maxBundlerBuySol =
        bundlerBuyAmountSol *
        (1 + Math.max(0, bundlerBuyVariancePercent) / 100);
      const requiredCreatorLamports = requiredBuyLamports(
        devBuyAmountSol,
        CREATE_FEE_BUFFER_LAMPORTS
      );
      const creatorTargetLamports =
        requiredCreatorLamports > MIN_CREATOR_BALANCE_LAMPORTS
          ? requiredCreatorLamports
          : MIN_CREATOR_BALANCE_LAMPORTS;
      const devFundingLamports =
        devWalletPublicKey === user.mainWallet.publicKey
          ? BigInt(0)
          : creatorTargetLamports;
      const bundlerFundingLamports = requiredBuyLamports(maxBundlerBuySol);
      const tipLamports = input.bundleBuyEnabled
        ? BigInt(Math.floor(jitoTipAmountSol * LAMPORTS_PER_SOL))
        : BigInt(0);
      const mainReserveLamports =
        tipLamports +
        (devWalletPublicKey === user.mainWallet.publicKey
          ? creatorTargetLamports
          : BigInt(0));
      const fundingTargets = [
        ...(devFundingLamports > BigInt(0)
          ? [
              {
                publicKey: devWalletKeypair.publicKey,
                requiredLamports: devFundingLamports,
              },
            ]
          : []),
        ...bundlerWalletKeypairs.map((wallet) => ({
          publicKey: wallet.publicKey,
          requiredLamports: bundlerFundingLamports,
        })),
      ];
      await appendLog(launchId, "INFO", "Funding plan prepared", "funding", {
        targetsCount: fundingTargets.length,
        devFundingLamports: devFundingLamports.toString(),
        creatorMinLamports: MIN_CREATOR_BALANCE_LAMPORTS.toString(),
        creatorTargetLamports: creatorTargetLamports.toString(),
        bundlerFundingLamports: bundlerFundingLamports.toString(),
        mainReserveLamports: mainReserveLamports.toString(),
        tipLamports: tipLamports.toString(),
        maxBundlerBuySol,
      });
      await fundWalletsFromMain(
        launchId,
        mainWalletKeypair,
        fundingTargets,
        mainReserveLamports
      );

      await setStep(launchId, 18, "metadata", "Preparing metadata");
      const metadataStartedAt = Date.now();
      const file = await resolveImageFile(input.tokenImage, input.tokenSymbol);
      const metadata = buildTokenMetadata(input, file);
      await appendLog(launchId, "INFO", "Metadata prepared", "metadata", {
        durationMs: Date.now() - metadataStartedAt,
        tokenImageSource,
        imageType: file.type,
        imageSize: file.size,
      });

      await setStep(launchId, 30, "mint", "Preparing mint");
      const mintStartedAt = Date.now();
      const mintReservation = await reserveMintIfRequested(
        launchId,
        user.id,
        input.vanityMint
      );
      const { mintKeypair } = mintReservation;
      reservedVanityId = mintReservation.reservedVanityId;
      await appendLog(launchId, "INFO", "Mint prepared", "mint", {
        durationMs: Date.now() - mintStartedAt,
        mintPublicKey: mintKeypair.publicKey.toBase58(),
        vanityMint: input.vanityMint,
        reservedVanityId,
      });

      if (await cancelLaunchIfRequested(launchId, reservedVanityId)) {
        return;
      }

      await setStep(launchId, 45, "create", "Creating token");
      const createStartedAt = Date.now();
      const pumpSdk = await createPumpSdk(devWalletKeypair);
      let bundleResult: { bundleId: string; signatures: string[] } | null = null;
      let createSignature: string | null = null;
      let bundleId: string | null = null;
      if (input.bundleBuyEnabled) {
        const bundlerBuyTargets = buildBundlerBuyTargets(
          bundlerWalletKeypairs,
          bundlerBuyAmountSol,
          bundlerBuyVariancePercent
        );
        const buyerWallets = bundlerBuyTargets.map((target) => target.wallet);
        const buyAmountsLamport = bundlerBuyTargets.map(
          (target) => target.amountLamports
        );
        const totalBuyLamports = bundlerBuyTargets.reduce(
          (total, target) => total + target.amountLamports,
          BigInt(0)
        );
        await appendLog(launchId, "INFO", "Bundle buy prepared", "create", {
          buyers: buyerWallets.length,
          totalBuySol: lamportsToSol(totalBuyLamports).toFixed(4),
          totalBuyLamports: totalBuyLamports.toString(),
        });
        bundleResult = await createAndBuyInBundle({
          launchId,
          creator: devWalletKeypair,
          mint: mintKeypair,
          metadata,
          creatorBuyAmountLamport: toLamports(devBuyAmountSol),
          buyerWallets,
          buyAmountsLamport,
          tipper: mainWalletKeypair,
          tipLamports: Math.max(
            0,
            Math.floor(jitoTipAmountSol * LAMPORTS_PER_SOL)
          ),
        });
        createSignature = bundleResult.signatures[0] ?? null;
        bundleId = bundleResult.bundleId;
        await appendLog(launchId, "INFO", "Create submitted", "create", {
          bundleId: bundleResult.bundleId,
          signatures: bundleResult.signatures,
          signatureCount: bundleResult.signatures.length,
          durationMs: Date.now() - createStartedAt,
        });
      } else {
        const createResult = await pumpSdk.createAndBuy(
          devWalletKeypair,
          mintKeypair,
          metadata,
          toLamports(devBuyAmountSol)
        );
        createSignature =
          (createResult as { signature?: string })?.signature ?? null;
        await appendLog(launchId, "INFO", "Create submitted", "create", {
          signature: (createResult as { signature?: string })?.signature,
          durationMs: Date.now() - createStartedAt,
        });
      }

      const mintPublicKey = mintKeypair.publicKey.toBase58();
      const mintPrivateKey = bs58.encode(mintKeypair.secretKey);

      await setStep(launchId, 55, "confirm", "Confirming token on-chain");
      const confirmation = await waitForMintAccount(mintPublicKey);
      await appendLog(launchId, "INFO", "Token confirmed", "confirm", {
        createSignature,
        bundleId,
        ...confirmation,
      });

      if (!input.bundleBuyEnabled) {
        await updateProgress(launchId, 65, "buys");
        await appendLog(launchId, "STEP", "Executing bundle buys", "buys");
        if (bundlerWalletKeypairs.length > 0) {
          const connection = getSolanaConnection();
          const buysStartedAt = Date.now();
          let executedCount = 0;
          let totalBuyLamports = BigInt(0);
          const buySignatures: string[] = [];
          for (let i = 0; i < bundlerWalletKeypairs.length; i += 1) {
            if (await isCancelRequested(launchId)) {
              await appendLog(
                launchId,
                "WARN",
                "Launch canceled before bundle buys completed",
                "cancel"
              );
              break;
            }
            const buyer = bundlerWalletKeypairs[i];
            const { amount, amountLamports } = buildBundlerBuyTarget(
              buyer,
              bundlerBuyAmountSol,
              bundlerBuyVariancePercent
            );
            if (amountLamports <= BigInt(0)) {
              continue;
            }
            const tx = await pumpSdk.getBuyInstructionsBySolAmount(
              buyer.publicKey,
              mintKeypair.publicKey,
              amountLamports,
              SLIPPAGE_BASIS_POINTS,
              "confirmed"
            );
            tx.feePayer = buyer.publicKey;
            const latestBlockhash = await connection.getLatestBlockhash(
              "confirmed"
            );
            tx.recentBlockhash = latestBlockhash.blockhash;
            const signature = await sendAndConfirmTransaction(
              connection,
              tx,
              [buyer],
              {
                commitment: "confirmed",
              }
            );
            buySignatures.push(signature);
            executedCount += 1;
            totalBuyLamports += amountLamports;
          }
          await appendLog(launchId, "INFO", "Bundle buys executed", "buys", {
            executedCount,
            totalBuySol: lamportsToSol(totalBuyLamports).toFixed(4),
            totalBuyLamports: totalBuyLamports.toString(),
            signatures: buySignatures,
            durationMs: Date.now() - buysStartedAt,
          });
        }
      }

      await updateProgress(launchId, 80, "persist");
      await appendLog(launchId, "STEP", "Saving token", "persist");

      const persistStartedAt = Date.now();
      const { token, distributionWalletCount } = await persistTokenAndWallets(
        input,
        user.id,
        mintPublicKey,
        mintPrivateKey,
        devWalletPublicKey,
        bundlerWalletKeypairs,
        reservedVanityId,
        distributionWalletMultiplier,
        launchId
      );
      await appendLog(launchId, "INFO", "Token saved", "persist", {
        tokenPublicKey: token.publicKey,
        distributionWalletCount,
        durationMs: Date.now() - persistStartedAt,
      });

      if (distributionWalletCount > 0) {
        await appendLog(launchId, "INFO", "Distribution wallets linked", "distribution", {
          count: distributionWalletCount,
        });
      }

      await finalizeLaunch(
        launchId,
        token.publicKey,
        devWalletPublicKey,
        user.mainWallet.publicKey,
        bundlerWalletKeypairs,
        recoveryData ??
          buildLaunchRecoveryData(
            input,
            user.mainWallet.publicKey,
            devWalletPublicKey,
            bundlerWalletKeypairs
          ),
        jitoTipAmountSol,
        Date.now() - launchStartedAt
      );
    } catch (error) {
      if (reservedVanityId) {
        await releaseVanityMint(reservedVanityId);
      }
      const durationMs = Date.now() - launchStartedAt;
      const errorName = error instanceof Error ? error.name : "UnknownError";
      const errorMessage = getErrorMessage(error);
      const isUserError = isAppError(error);
      const clientMessage = isUserError
        ? error.message
        : resolveLaunchClientMessage(error, errorMessage);
      if (isUserError) {
        logger.error("Launch failed", {
          launchId,
          errorName,
          errorMessage: error.message,
          statusCode: error.statusCode,
          durationMs,
        });
      } else {
        const context: Record<string, unknown> = {
          launchId,
          errorName,
          durationMs,
        };
        if (errorMessage) {
          context.errorMessage = errorMessage;
        }
        logger.error("Launch failed", context);
      }
      await prisma.launch.update({
        where: { id: launchId },
        data: {
          status: "FAILED",
          errorMessage: clientMessage,
          completedAt: new Date(),
        },
      });
      const logData: Prisma.InputJsonObject = {
        durationMs,
        errorName,
        ...(errorMessage ? { errorMessage } : {}),
      };
      await appendLog(launchId, "ERROR", clientMessage, "error", logData);
    }
  },
};
