import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { AppError, isAppError } from "@/server/errors";
import { logger } from "@/lib/logger";
import type { LaunchTokenInput } from "@/server/schemas/launch.schema";
import { getSolanaConnection } from "@/lib/solana/connection";
import { getLaunchConfig } from "@/lib/config/launch.config";
import { getEnv } from "@/lib/config/env";
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
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import bs58 from "bs58";
import { PumpFunSDK, calculateWithSlippageBuy } from "pumpdotfun-sdk";
import { createAndBuyInBundle } from "@/server/solana/bundle-create-and-buy";
import {
  buildCreateTokenTransaction,
  type PumpMetadataUpload,
} from "@/server/solana/pump-transaction-builders";
import { grpcManager } from "@/server/solana/grpc-manager";
import { shyftCallbackService } from "@/server/services/shyft-callback.service";

type LaunchLogLevel = "INFO" | "WARN" | "ERROR" | "STEP";
type LaunchRecord = Prisma.LaunchGetPayload<Prisma.LaunchDefaultArgs>;

function toLamports(amount: number) {
  return BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
}

function lamportsToSol(lamports: bigint) {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

const MAIN_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/jpg",
]);
const MAIN_VIDEO_MIME_TYPES = new Set(["video/mp4"]);
const BANNER_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/jpg",
]);
const MAIN_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const MAIN_VIDEO_MAX_BYTES = 30 * 1024 * 1024;
const BANNER_MAX_BYTES = Math.floor(4.3 * 1024 * 1024);

type LaunchRecoveryData = {
  mainWalletPublicKey: string;
  devWalletPublicKey: string;
  usesMainWalletAsDev: boolean;
  devWalletManaged: boolean;
  bundlerWallets: string[];
  distributionWallets: string[];
};

type DistributionWallet = {
  parentIndex: number;
  wallet: Keypair;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMimeType(mime: string) {
  return mime.split(";")[0]?.trim().toLowerCase() ?? "";
}

function fileExtensionForMime(mime: string) {
  if (mime === "image/jpeg" || mime === "image/jpg") {
    return "jpg";
  }
  if (mime === "image/png") {
    return "png";
  }
  if (mime === "image/gif") {
    return "gif";
  }
  if (mime === "video/mp4") {
    return "mp4";
  }
  return "bin";
}

function parseDataUrl(dataUrl: string) {
  const [header, data] = dataUrl.split(",");
  const mimeMatch = header?.match(/data:(.*?);base64/);
  if (!mimeMatch) {
    throw new AppError("Invalid file format", 400);
  }
  const mime = normalizeMimeType(mimeMatch[1]);
  const buffer = Buffer.from(data, "base64");
  return { mime, buffer };
}

function ensureMainMediaConstraints(mime: string, size: number) {
  const isImage = MAIN_IMAGE_MIME_TYPES.has(mime);
  const isVideo = MAIN_VIDEO_MIME_TYPES.has(mime);
  if (!isImage && !isVideo) {
    throw new AppError("Unsupported main media type", 400);
  }
  if (isImage && size > MAIN_IMAGE_MAX_BYTES) {
    throw new AppError("Main image must be 15MB or smaller", 400);
  }
  if (isVideo && size > MAIN_VIDEO_MAX_BYTES) {
    throw new AppError("Main video must be 30MB or smaller", 400);
  }
}

function ensureBannerConstraints(mime: string, size: number) {
  if (!BANNER_IMAGE_MIME_TYPES.has(mime)) {
    throw new AppError("Unsupported banner image type", 400);
  }
  if (size > BANNER_MAX_BYTES) {
    throw new AppError("Banner image must be 4.3MB or smaller", 400);
  }
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

function isJitoRateLimitMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("jito") ||
    normalized.includes("block engine") ||
    normalized.includes("searcherclienterror") ||
    normalized.includes("globally rate limited") ||
    normalized.includes("network congested")
  );
}

function resolveLaunchClientMessage(error: unknown, message: string) {
  if (isRateLimitError(error, message)) {
    if (isJitoRateLimitMessage(message)) {
      return "Jito block engine rate limit reached. Please try again shortly.";
    }
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
  bundlerWalletKeypairs: Keypair[],
  distributionWallets: DistributionWallet[]
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
    distributionWallets: distributionWallets.map((wallet) =>
      wallet.wallet.publicKey.toBase58()
    ),
  };
}

function parseLaunchRecoveryObject(
  value: Record<string, unknown>
): LaunchRecoveryData | null {
  const mainWalletPublicKey =
    typeof value.mainWalletPublicKey === "string"
      ? value.mainWalletPublicKey
      : "";
  const devWalletPublicKey =
    typeof value.devWalletPublicKey === "string"
      ? value.devWalletPublicKey
      : "";
  const bundlerWallets = Array.isArray(value.bundlerWallets)
    ? value.bundlerWallets.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
  const distributionWallets = Array.isArray(value.distributionWallets)
    ? value.distributionWallets.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
  const usesMainWalletAsDev =
    value.usesMainWalletAsDev === true ||
    (Boolean(mainWalletPublicKey) &&
      Boolean(devWalletPublicKey) &&
      mainWalletPublicKey === devWalletPublicKey);
  const devWalletManaged = value.devWalletManaged === true;
  if (
    !devWalletPublicKey &&
    bundlerWallets.length === 0 &&
    distributionWallets.length === 0
  ) {
    return null;
  }
  return {
    mainWalletPublicKey,
    devWalletPublicKey,
    usesMainWalletAsDev,
    devWalletManaged,
    bundlerWallets,
    distributionWallets,
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

async function setLaunchRecovery(
  launchId: string,
  recovery: LaunchRecoveryData
) {
  await prisma.launch.update({
    where: { id: launchId },
    data: {
      result: { recovery },
    },
  });
}

function buildTokenMetadata(
  input: LaunchTokenInput,
  file: File,
  bannerFile?: File | null
): PumpMetadataUpload {
  const metadata: PumpMetadataUpload = {
    name: input.tokenName.trim(),
    symbol: normalizeSymbol(input.tokenSymbol),
    description: input.description.trim(),
    file,
  };

  if (bannerFile) {
    metadata.bannerFile = bannerFile;
  }

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

async function resolveMainMediaFile(tokenImage: string, symbol: string) {
  if (!tokenImage) {
    throw new AppError("Main image or video is required", 400);
  }

  if (tokenImage.startsWith("data:")) {
    const { mime, buffer } = parseDataUrl(tokenImage);
    ensureMainMediaConstraints(mime, buffer.length);
    const extension = fileExtensionForMime(mime);
    return new File([buffer], `${symbol}.${extension}`, { type: mime });
  }

  const response = await fetch(tokenImage);
  if (!response.ok) {
    throw new AppError("Failed to fetch main media", 400);
  }
  const arrayBuffer = await response.arrayBuffer();
  const contentType = normalizeMimeType(
    response.headers.get("content-type") || ""
  );
  const buffer = Buffer.from(arrayBuffer);
  ensureMainMediaConstraints(contentType, buffer.length);
  const extension = fileExtensionForMime(contentType);
  return new File([buffer], `${symbol}.${extension}`, { type: contentType });
}

async function resolveBannerFile(tokenBanner: string, symbol: string) {
  if (!tokenBanner?.trim()) {
    return null;
  }

  if (tokenBanner.startsWith("data:")) {
    const { mime, buffer } = parseDataUrl(tokenBanner);
    ensureBannerConstraints(mime, buffer.length);
    const extension = fileExtensionForMime(mime);
    return new File([buffer], `${symbol}-banner.${extension}`, { type: mime });
  }

  const response = await fetch(tokenBanner);
  if (!response.ok) {
    throw new AppError("Failed to fetch banner image", 400);
  }
  const arrayBuffer = await response.arrayBuffer();
  const contentType = normalizeMimeType(
    response.headers.get("content-type") || ""
  );
  const buffer = Buffer.from(arrayBuffer);
  ensureBannerConstraints(contentType, buffer.length);
  const extension = fileExtensionForMime(contentType);
  return new File([buffer], `${symbol}-banner.${extension}`, {
    type: contentType,
  });
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
  const {
    launchStaleMs: LAUNCH_STALE_MS,
    launchStaleError: LAUNCH_STALE_ERROR,
  } = getLaunchConfig();
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

async function consumeVanityMint(userId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await prisma.vanityMint.findFirst({
      where: {
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
        usedAt: null,
        tokenPublicKey: null,
      },
      data: {
        usedAt: new Date(),
        userId,
      },
    });

    if (lock.count === 1) {
      return candidate;
    }
  }

  return null;
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

async function waitForMintAccount(mintPublicKey: string, launchId?: string) {
  const {
    mintConfirmTimeoutMs: MINT_CONFIRM_TIMEOUT_MS,
    mintConfirmIntervalMs: MINT_CONFIRM_INTERVAL_MS,
  } = getLaunchConfig();
  const connection = getSolanaConnection();
  const mintKey = new PublicKey(mintPublicKey);
  const startedAt = Date.now();
  const subscriptionId = launchId ? `launch:${launchId}` : `launch:${mintPublicKey}`;

  type MintResult = {
    source: "grpc" | "rpc";
    attempts: number;
    durationMs: number;
    owner: string;
    lamports: number;
    dataLength: number;
  };

  const grpcPromise = new Promise<MintResult>((resolve) => {
    if (!grpcManager.isConnected()) {
      return;
    }

    grpcManager.subscribe(subscriptionId, [mintPublicKey]).catch(() => {});

    const removeListener = grpcManager.onAccountUpdate((update) => {
      if (update.pubkey === mintPublicKey && update.lamports > 0) {
        removeListener();
        resolve({
          source: "grpc",
          attempts: 0,
          durationMs: Date.now() - startedAt,
          owner: update.owner ?? "unknown",
          lamports: update.lamports,
          dataLength: 0,
        });
      }
    });

    setTimeout(() => {
      removeListener();
    }, MINT_CONFIRM_TIMEOUT_MS);
  });

  const rpcPromise = (async (): Promise<MintResult> => {
    let attempts = 0;
    while (Date.now() - startedAt < MINT_CONFIRM_TIMEOUT_MS) {
      attempts += 1;
      const account = await connection.getAccountInfo(mintKey, "confirmed");
      if (account) {
        return {
          source: "rpc",
          attempts,
          durationMs: Date.now() - startedAt,
          owner: account.owner.toBase58(),
          lamports: account.lamports,
          dataLength: account.data.length,
        };
      }
      await new Promise((resolve) =>
        setTimeout(resolve, MINT_CONFIRM_INTERVAL_MS)
      );
    }
    throw new AppError(
      "Token mint not found on chain. The create transaction may have failed or the RPC cluster does not match pump.fun.",
      500
    );
  })();

  try {
    const result = await Promise.race([grpcPromise, rpcPromise]);
    grpcManager.unsubscribe(subscriptionId);
    return result;
  } catch (error) {
    grpcManager.unsubscribe(subscriptionId);
    throw error;
  }
}

function keypairFromPrivateKey(privateKey: string) {
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

function requiredBuyLamports(
  amountSol: number,
  extraBufferLamports = 0,
  rentLamports = BigInt(0)
) {
  const {
    fundingBufferLamports: FUNDING_BUFFER_LAMPORTS,
    transferFeeBufferLamports: TRANSFER_FEE_BUFFER_LAMPORTS,
  } = getLaunchConfig();
  if (amountSol <= 0) {
    return BigInt(0);
  }
  return (
    toLamports(amountSol) +
    BigInt(FUNDING_BUFFER_LAMPORTS + TRANSFER_FEE_BUFFER_LAMPORTS) +
    BigInt(extraBufferLamports) +
    rentLamports
  );
}

async function fundWalletsFromMain(
  launchId: string,
  mainWalletKeypair: Keypair,
  targets: { publicKey: PublicKey; requiredLamports: bigint }[],
  mainReserveLamports: bigint
) {
  const { fundingBatchSize: FUNDING_BATCH_SIZE } = getLaunchConfig();
  const connection = getSolanaConnection();
  const startedAt = Date.now();
  const uniqueTargets = targets.filter(
    (target, index, all) =>
      all.findIndex((item) => item.publicKey.equals(target.publicKey)) === index
  );

  if (uniqueTargets.length === 0) {
    await appendLog(launchId, "INFO", "No wallet funding needed", "funding", {
      fundedCount: 0,
      totalLamports: "0",
      totalSol: "0.0000",
      durationMs: Date.now() - startedAt,
    });
    return {
      fundedCount: 0,
      totalLamports: BigInt(0),
      signatures: [] as string[],
    };
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
    return {
      fundedCount: 0,
      totalLamports: BigInt(0),
      signatures: [] as string[],
    };
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
  const { minBuyAmountSol: MIN_BUY_AMOUNT_SOL } = getLaunchConfig();
  const devBuyAmountSol = input.devBuyAmountSol;
  const jitoTipAmountSol = input.jitoTipAmountSol;
  const bundlerWalletCount = Math.max(0, Math.floor(input.bundlerWalletCount));
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
    throw new AppError(
      `Dev buy must be at least ${MIN_BUY_AMOUNT_SOL} SOL`,
      400
    );
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

async function ensureDistributionWallets(
  userId: string,
  bundlerWalletKeypairs: Keypair[],
  distributionWalletMultiplier: number
) {
  if (bundlerWalletKeypairs.length === 0 || distributionWalletMultiplier <= 1) {
    return [] as DistributionWallet[];
  }
  const distributionWallets: DistributionWallet[] = [];
  const walletsPerBundler = Math.max(0, distributionWalletMultiplier - 1);
  for (let i = 0; i < bundlerWalletKeypairs.length; i += 1) {
    for (let j = 0; j < walletsPerBundler; j += 1) {
      distributionWallets.push({ parentIndex: i, wallet: Keypair.generate() });
    }
  }
  if (distributionWallets.length === 0) {
    return distributionWallets;
  }
  await prisma.wallet.createMany({
    data: distributionWallets.map((wallet) => ({
      publicKey: wallet.wallet.publicKey.toBase58(),
      privateKey: bs58.encode(wallet.wallet.secretKey),
      type: "DISTRIBUTION",
      userId,
    })),
  });
  return distributionWallets;
}

async function cancelLaunchIfRequested(launchId: string) {
  if (!(await isCancelRequested(launchId))) {
    return false;
  }
  await appendLog(launchId, "WARN", "Launch canceled", "cancel");
  await prisma.launch.update({
    where: { id: launchId },
    data: { status: "CANCELED", completedAt: new Date() },
  });
  return true;
}

async function reserveMintIfRequested(
  launchId: string,
  userId: string,
  vanityRequested: boolean
) {
  if (!vanityRequested) {
    return { mintKeypair: Keypair.generate(), consumedVanityId: null };
  }
  const consumed = await consumeVanityMint(userId);
  if (!consumed) {
    throw new AppError(
      "Vanity mint requested but no vanity mints available. Please add more vanity mints to the pool.",
      400
    );
  }
  let mintKeypair: Keypair;
  try {
    mintKeypair = keypairFromPrivateKey(consumed.privateKey);
  } catch {
    throw new AppError(
      "Vanity mint has an invalid private key. Please check the vanity mint pool.",
      500
    );
  }
  await appendLog(launchId, "INFO", "Using vanity mint", "mint", {
    publicKey: consumed.publicKey,
  });
  return {
    mintKeypair,
    consumedVanityId: consumed.id,
  };
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

async function distributeTokensToWallets(
  launchId: string,
  mint: PublicKey,
  bundlerWalletKeypairs: Keypair[],
  distributionWallets: DistributionWallet[],
  distributionWalletMultiplier: number
) {
  const startedAt = Date.now();
  if (
    distributionWalletMultiplier <= 1 ||
    bundlerWalletKeypairs.length === 0 ||
    distributionWallets.length === 0
  ) {
    return {
      totalWallets: distributionWallets.length,
      sourceWalletsWithBalance: 0,
      transferCount: 0,
      totalTokensRaw: "0",
      signatures: [] as string[],
      skippedWallets: 0,
      failedTransfers: 0,
      canceled: false,
      durationMs: Date.now() - startedAt,
    };
  }

  const connection = getSolanaConnection();
  const grouped = new Map<number, Keypair[]>();
  distributionWallets.forEach((wallet) => {
    const list = grouped.get(wallet.parentIndex) ?? [];
    list.push(wallet.wallet);
    grouped.set(wallet.parentIndex, list);
  });

  const signatures: string[] = [];
  let transferCount = 0;
  let totalTokensRaw = BigInt(0);
  let sourceWalletsWithBalance = 0;
  let skippedWallets = 0;
  let failedTransfers = 0;
  let canceled = false;

  for (let i = 0; i < bundlerWalletKeypairs.length; i += 1) {
    if (await isCancelRequested(launchId)) {
      canceled = true;
      break;
    }
    const sourceWallet = bundlerWalletKeypairs[i];
    const childWallets = grouped.get(i) ?? [];
    if (childWallets.length === 0) {
      continue;
    }
    const sourceAta = await getAssociatedTokenAddress(
      mint,
      sourceWallet.publicKey
    );
    let tokenBalance = BigInt(0);
    try {
      const account = await getAccount(connection, sourceAta);
      tokenBalance = account.amount;
    } catch (error) {
      failedTransfers += 1;
      await appendLog(
        launchId,
        "WARN",
        "Distribution balance lookup failed",
        "distribution",
        {
          sourceWallet: sourceWallet.publicKey.toBase58(),
          error: getErrorMessage(error),
        }
      );
      continue;
    }
    if (tokenBalance <= BigInt(0)) {
      skippedWallets += 1;
      continue;
    }
    const amountPerWallet = tokenBalance / BigInt(distributionWalletMultiplier);
    if (amountPerWallet <= BigInt(0)) {
      skippedWallets += 1;
      continue;
    }
    sourceWalletsWithBalance += 1;
    for (let j = 0; j < childWallets.length; j += 1) {
      if (await isCancelRequested(launchId)) {
        canceled = true;
        break;
      }
      const destination = childWallets[j];
      const destinationAta = await getAssociatedTokenAddress(
        mint,
        destination.publicKey
      );
      try {
        const transaction = new Transaction();
        const destinationInfo = await connection.getAccountInfo(destinationAta);
        if (!destinationInfo) {
          transaction.add(
            createAssociatedTokenAccountInstruction(
              sourceWallet.publicKey,
              destinationAta,
              destination.publicKey,
              mint
            )
          );
        }
        transaction.add(
          createTransferInstruction(
            sourceAta,
            destinationAta,
            sourceWallet.publicKey,
            amountPerWallet
          )
        );
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = sourceWallet.publicKey;
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [sourceWallet],
          { commitment: "confirmed" }
        );
        signatures.push(signature);
        transferCount += 1;
        totalTokensRaw += amountPerWallet;
      } catch (error) {
        failedTransfers += 1;
        await appendLog(
          launchId,
          "WARN",
          "Distribution transfer failed",
          "distribution",
          {
            sourceWallet: sourceWallet.publicKey.toBase58(),
            destinationWallet: destination.publicKey.toBase58(),
            error: getErrorMessage(error),
          }
        );
      }
    }
    if (canceled) {
      break;
    }
  }

  return {
    totalWallets: distributionWallets.length,
    sourceWalletsWithBalance,
    transferCount,
    totalTokensRaw: totalTokensRaw.toString(),
    signatures,
    skippedWallets,
    failedTransfers,
    canceled,
    durationMs: Date.now() - startedAt,
  };
}

async function persistTokenAndWallets(
  input: LaunchTokenInput,
  userId: string,
  mintPublicKey: string,
  mintPrivateKey: string,
  devWalletPublicKey: string,
  bundlerWalletKeypairs: Keypair[],
  distributionWallets: DistributionWallet[],
  consumedVanityId: string | null
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

      if (consumedVanityId) {
        await tx.vanityMint.update({
          where: { id: consumedVanityId },
          data: {
            tokenPublicKey: createdToken.publicKey,
          },
        });
      }

      if (distributionWallets.length > 0) {
        distributionWalletCount = distributionWallets.length;
        await tx.wallet.updateMany({
          where: {
            publicKey: {
              in: distributionWallets.map((wallet) =>
                wallet.wallet.publicKey.toBase58()
              ),
            },
          },
          data: {
            tokenPublicKey: createdToken.publicKey,
          },
        });
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
  await appendLog(
    launchId,
    "INFO",
    "Launch complete",
    "complete",
    completionData
  );
}

async function loadLaunchRecoveryInfo(launchId: string, userId: string) {
  const launch = await prisma.launch.findFirst({
    where: { id: launchId, userId },
  });

  if (!launch) {
    throw new AppError("Launch not found", 404);
  }

  const resolvedLaunch = await markLaunchStaleIfNeeded(launch);
  if (
    resolvedLaunch.status === "PENDING" ||
    resolvedLaunch.status === "RUNNING"
  ) {
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
    recovery.distributionWallets.forEach((key) => walletKeys.add(key));
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
      .filter((wallet): wallet is NonNullable<(typeof walletRecords)[number]> =>
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
    const { transferFeeBufferLamports: TRANSFER_FEE_BUFFER_LAMPORTS } =
      getLaunchConfig();
    const {
      launch,
      mainWalletPublicKey,
      walletPublicKeys: recoveryWallets,
    } = await loadLaunchRecoveryInfo(launchId, userId);

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
      const lamportsToSend = balanceLamports - TRANSFER_FEE_BUFFER_LAMPORTS;
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
    const {
      createFeeBufferLamports: CREATE_FEE_BUFFER_LAMPORTS,
      minCreatorBalanceLamports: MIN_CREATOR_BALANCE_LAMPORTS,
      slippageBasisPoints: SLIPPAGE_BASIS_POINTS,
    } = getLaunchConfig();
    let consumedVanityId: string | null = null;
    let recoveryData: LaunchRecoveryData | null = null;

    try {
      const tokenMediaSource = input.tokenImage
        ? input.tokenImage.startsWith("data:")
          ? "inline"
          : "url"
        : "missing";
      const tokenMediaType = input.tokenImage
        ? input.tokenImage.startsWith("data:video")
          ? "video"
          : input.tokenImage.startsWith("data:image")
            ? "image"
            : "unknown"
        : "missing";
      const tokenBannerSource = input.tokenBanner?.trim()
        ? input.tokenBanner.startsWith("data:")
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
        tokenMediaSource,
        tokenMediaType,
        tokenBannerSource,
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
      const distributionWallets =
        bundlerWalletKeypairs.length > 0
          ? await ensureDistributionWallets(
              user.id,
              bundlerWalletKeypairs,
              distributionWalletMultiplier
            )
          : [];
      await appendLog(launchId, "INFO", "Wallets prepared", "wallets", {
        mainWalletPublicKey: user.mainWallet.publicKey,
        devWalletPublicKey,
        usesMainWalletAsDev: devWalletPublicKey === user.mainWallet.publicKey,
        devWalletOption: input.devWalletOption,
        bundlerWallets: bundlerWalletKeypairs.length,
        distributionWallets: distributionWallets.length,
        distributionWalletMultiplier,
        bundleBuyEnabled: input.bundleBuyEnabled,
        durationMs: Date.now() - walletsStartedAt,
      });
      recoveryData = buildLaunchRecoveryData(
        input,
        user.mainWallet.publicKey,
        devWalletPublicKey,
        bundlerWalletKeypairs,
        distributionWallets
      );
      await setLaunchRecovery(launchId, recoveryData);

      const { SHYFT_API_KEY, APP_URL } = getEnv();
      if (SHYFT_API_KEY && APP_URL) {
        const callbackUrl = `${APP_URL}/api/webhooks/shyft`;
        const walletAddresses = [
          ...bundlerWalletKeypairs.map((w) => w.publicKey.toBase58()),
          ...distributionWallets.map((w) => w.wallet.publicKey.toBase58()),
        ];
        if (devWalletPublicKey !== user.mainWallet.publicKey) {
          walletAddresses.push(devWalletPublicKey);
        }
        for (const address of walletAddresses) {
          try {
            await shyftCallbackService.createTransactionCallback({
              address,
              callbackUrl,
              events: ["SWAP", "TOKEN_TRANSFER", "SOL_TRANSFER"],
            });
          } catch {
            // best-effort, don't block launch
          }
        }
      }

      if (await cancelLaunchIfRequested(launchId)) {
        return;
      }

      await setStep(launchId, 12, "funding", "Funding wallets");
      const connection = getSolanaConnection();
      const ataRentLamports = BigInt(
        await connection.getMinimumBalanceForRentExemption(165)
      );
      const userVolumeAccumulatorRentLamports = BigInt(
        await connection.getMinimumBalanceForRentExemption(74)
      );
      const buyRentLamports =
        ataRentLamports + userVolumeAccumulatorRentLamports;
      const distributionWalletsPerBundler =
        distributionWalletMultiplier > 1 ? distributionWalletMultiplier - 1 : 0;
      const distributionAtaLamports =
        distributionWalletsPerBundler > 0
          ? ataRentLamports * BigInt(distributionWalletsPerBundler)
          : BigInt(0);
      const maxBundlerBuySol =
        bundlerBuyAmountSol *
        (1 + Math.max(0, bundlerBuyVariancePercent) / 100);
      const requiredCreatorLamports = requiredBuyLamports(
        devBuyAmountSol,
        CREATE_FEE_BUFFER_LAMPORTS,
        buyRentLamports
      );
      const creatorTargetLamports =
        requiredCreatorLamports > MIN_CREATOR_BALANCE_LAMPORTS
          ? requiredCreatorLamports
          : MIN_CREATOR_BALANCE_LAMPORTS;
      const devFundingLamports =
        devWalletPublicKey === user.mainWallet.publicKey
          ? BigInt(0)
          : creatorTargetLamports;
      const bundlerFundingLamports = requiredBuyLamports(
        maxBundlerBuySol,
        0,
        buyRentLamports + distributionAtaLamports
      );
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
        ataRentLamports: ataRentLamports.toString(),
        userVolumeAccumulatorRentLamports:
          userVolumeAccumulatorRentLamports.toString(),
        buyRentLamports: buyRentLamports.toString(),
        distributionAtaLamports: distributionAtaLamports.toString(),
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
      const file = await resolveMainMediaFile(
        input.tokenImage,
        input.tokenSymbol
      );
      const bannerFile = await resolveBannerFile(
        input.tokenBanner ?? "",
        input.tokenSymbol
      );
      const metadata = buildTokenMetadata(input, file, bannerFile);
      await appendLog(launchId, "INFO", "Metadata prepared", "metadata", {
        durationMs: Date.now() - metadataStartedAt,
        tokenMediaSource,
        imageType: file.type,
        imageSize: file.size,
        bannerType: bannerFile?.type ?? null,
        bannerSize: bannerFile?.size ?? null,
      });

      await setStep(launchId, 30, "mint", "Preparing mint");
      const mintStartedAt = Date.now();
      const mintReservation = await reserveMintIfRequested(
        launchId,
        user.id,
        input.vanityMint
      );
      const { mintKeypair } = mintReservation;
      consumedVanityId = mintReservation.consumedVanityId;
      await appendLog(launchId, "INFO", "Mint prepared", "mint", {
        durationMs: Date.now() - mintStartedAt,
        mintPublicKey: mintKeypair.publicKey.toBase58(),
        vanityMint: input.vanityMint,
        consumedVanityId,
      });

      if (await cancelLaunchIfRequested(launchId)) {
        return;
      }

      await setStep(launchId, 45, "create", "Creating token");
      const createStartedAt = Date.now();
      const pumpSdk = await createPumpSdk(devWalletKeypair);
      let bundleResult: { bundleId: string; signatures: string[] } | null =
        null;
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
        const { createTx } = await buildCreateTokenTransaction(
          devWalletKeypair,
          mintKeypair,
          metadata
        );
        const connection = getSolanaConnection();
        if (devBuyAmountSol > 0) {
          const globalAccount = await pumpSdk.getGlobalAccount("confirmed");
          const buyAmount = globalAccount.getInitialBuyPrice(
            toLamports(devBuyAmountSol)
          );
          const buyAmountWithSlippage = calculateWithSlippageBuy(
            toLamports(devBuyAmountSol),
            SLIPPAGE_BASIS_POINTS
          );
          const buyTx = await pumpSdk.getBuyInstructions(
            devWalletKeypair.publicKey,
            mintKeypair.publicKey,
            globalAccount.feeRecipient,
            buyAmount,
            buyAmountWithSlippage
          );
          createTx.add(...buyTx.instructions);
        }
        if (!createTx.feePayer) {
          createTx.feePayer = devWalletKeypair.publicKey;
        }
        const latestBlockhash =
          await connection.getLatestBlockhash("confirmed");
        createTx.recentBlockhash = latestBlockhash.blockhash;
        createSignature = await sendAndConfirmTransaction(
          connection,
          createTx,
          [devWalletKeypair, mintKeypair],
          { commitment: "confirmed" }
        );
        await appendLog(launchId, "INFO", "Create submitted", "create", {
          signature: createSignature,
          durationMs: Date.now() - createStartedAt,
        });
      }

      const mintPublicKey = mintKeypair.publicKey.toBase58();
      const mintPrivateKey = bs58.encode(mintKeypair.secretKey);

      await setStep(launchId, 55, "confirm", "Confirming token on-chain");
      const confirmation = await waitForMintAccount(mintPublicKey, launchId);
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
            const latestBlockhash =
              await connection.getLatestBlockhash("confirmed");
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

      if (distributionWallets.length > 0) {
        await setStep(launchId, 72, "distribution", "Distributing tokens");
        const distributionSummary = await distributeTokensToWallets(
          launchId,
          mintKeypair.publicKey,
          bundlerWalletKeypairs,
          distributionWallets,
          distributionWalletMultiplier
        );
        await appendLog(
          launchId,
          "INFO",
          "Distribution complete",
          "distribution",
          {
            totalWallets: distributionSummary.totalWallets,
            sourceWalletsWithBalance:
              distributionSummary.sourceWalletsWithBalance,
            transferCount: distributionSummary.transferCount,
            totalTokensRaw: distributionSummary.totalTokensRaw,
            signatures: distributionSummary.signatures,
            skippedWallets: distributionSummary.skippedWallets,
            failedTransfers: distributionSummary.failedTransfers,
            canceled: distributionSummary.canceled,
            durationMs: distributionSummary.durationMs,
          }
        );
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
        distributionWallets,
        consumedVanityId
      );
      await appendLog(launchId, "INFO", "Token saved", "persist", {
        tokenPublicKey: token.publicKey,
        distributionWalletCount,
        durationMs: Date.now() - persistStartedAt,
      });

      if (distributionWalletCount > 0) {
        await appendLog(
          launchId,
          "INFO",
          "Distribution wallets linked",
          "distribution",
          {
            count: distributionWalletCount,
          }
        );
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
            bundlerWalletKeypairs,
            distributionWallets
          ),
        jitoTipAmountSol,
        Date.now() - launchStartedAt
      );
    } catch (error) {
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
      try {
        const recoveryResult = await this.recoverSol(launchId, launch.userId);
        await appendLog(
          launchId,
          "INFO",
          "Recovery complete",
          "recovery",
          recoveryResult as Prisma.InputJsonValue
        );
      } catch (recoveryError) {
        const recoveryMessage =
          getErrorMessage(recoveryError) || "Recovery failed";
        await appendLog(launchId, "WARN", recoveryMessage, "recovery", {
          errorName:
            recoveryError instanceof Error
              ? recoveryError.name
              : "UnknownError",
          ...(recoveryMessage ? { errorMessage: recoveryMessage } : {}),
        });
      }
    }
  },
};
