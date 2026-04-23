import "server-only";
import { prisma } from "@/lib/prisma";
import { UserPlan, type Prisma } from "@/lib/generated/prisma/client";
import { AppError, isAppError } from "@/server/errors";
import { appTransactionService } from "@/server/services/app-transaction.service";
import { logger } from "@/lib/logger";
import {
  launchTokenSchema,
  type LaunchPreviewCostsInput,
  type LaunchTokenInput,
} from "@/server/schemas/launch.schema";
import { getSolanaConnection } from "@/lib/solana/connection";
import { getLaunchConfig } from "@/lib/config/launch.config";
import {
  calculateLaunchUsageFees,
  waiveLaunchUsageFees,
  discountLaunchUsageFees,
} from "@/lib/config/usage-fees.config";
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
import { PumpFunSDK } from "pumpdotfun-sdk";
import { createAndBuyInBundle } from "@/server/solana/bundle-create-and-buy";
import { appendLaunchDevBuyInstructions } from "@/server/solana/launch-dev-buy";
import type { BundleTelemetryEvent } from "@/server/solana/jito-bundle";
import {
  buildCreateTokenTransaction,
  type PumpMetadataUpload,
} from "@/server/solana/pump-transaction-builders";
import { grpcManager } from "@/server/solana/grpc-manager";
import { shyftCallbackService } from "@/server/services/shyft-callback.service";
import { testRunLogService } from "@/server/services/test-run-log.service";
import { walletService } from "@/server/services/wallet.service";
import { persistGeneratedPrivateKey } from "@/server/services/private-key-persistence.service";
import { persistLaunchLog } from "@/server/services/log-persistence.service";
import { summarizeFailureRecoveryAttempt } from "@/server/services/launch-failure-recovery.helpers";
import { storageService } from "@/server/services/storage.service";
import { usageFeeService } from "@/server/services/usage-fee.service";
import { retryLaunchDbWrite } from "@/server/services/launch-db.helpers";
import { withActionLock, withIdempotency } from "@/server/security/api-abuse";
import { computeFailedLaunchDrainLamports } from "@/server/services/launch-failure-recovery.helpers";
import { grpcAccessService } from "@/server/services/grpc-access.service";
import { invalidateStatsCache } from "@/server/services/dashboard.service";
import { allocateFixedTotalBundleLamports } from "@/server/services/launch-bundle-allocation";
import type { ContextUser } from "@/server/schemas/auth.schema";
import {
  computeSponsoredRecoverableLamports,
  resolveBatchReclaimMode,
} from "@/lib/utils/sol-recovery";

type LaunchLogLevel = "INFO" | "WARN" | "ERROR" | "STEP";
type LaunchRecord = Prisma.LaunchGetPayload<Prisma.LaunchDefaultArgs>;
type RequestUser = Pick<ContextUser, "id" | "plan">;
type StoredLaunchInput = LaunchTokenInput & {
  entitlementSnapshot?: {
    plan: ContextUser["plan"];
    launchRealtimeEnabled: boolean;
    platformFeeWaived: boolean;
  };
};
const LAUNCH_LOG_WINDOW = 200;

function toLamports(amount: number) {
  return BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
}

function lamportsToSol(lamports: bigint) {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

const MIN_BUNDLER_BUY_AMOUNT_SOL = 0.1;
const MIN_BUNDLER_BUY_AMOUNT_LAMPORTS = toLamports(MIN_BUNDLER_BUY_AMOUNT_SOL);

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

const LAUNCH_ATTRIBUTION_TEXT = "Launched with ballistik.app";

function applyLaunchFeePolicy(
  input: LaunchTokenInput | LaunchPreviewCostsInput,
  user: Pick<ContextUser, "plan">
) {
  const usageFees = calculateLaunchUsageFees({
    devWalletOption: input.devWalletOption,
    bundleBuyEnabled: input.bundleBuyEnabled,
    bundlerWalletCount: input.bundlerWalletCount,
    distributionWalletMultiplier: input.distributionWalletMultiplier,
    vanityMint: input.vanityMint,
    removeAttribution: input.removeAttribution,
  });
  const discountRate = grpcAccessService.getPlatformFeeDiscountRate(user);
  if (discountRate >= 1) return waiveLaunchUsageFees(usageFees);
  if (discountRate > 0) return discountLaunchUsageFees(usageFees, discountRate);
  return usageFees;
}

function composeTokenDescription(input: LaunchTokenInput) {
  const baseDescription = input.description?.trim() || "";
  if (input.removeAttribution) {
    return baseDescription;
  }
  if (!baseDescription) {
    return LAUNCH_ATTRIBUTION_TEXT;
  }
  return `${baseDescription}\n\n${LAUNCH_ATTRIBUTION_TEXT}`;
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

type SolReturnResult = {
  publicKey: string;
  status: "returned" | "skipped" | "failed";
  signature?: string;
  amountSol?: number;
  remainingBalanceSol?: number;
  error?: string;
};

type DistributionWallet = {
  parentIndex: number;
  wallet: Keypair;
};

type LaunchWalletFundingSnapshot = {
  publicKey: string;
  fundedLamports: bigint;
};

type BundlerBuyTarget = {
  wallet: Keypair;
  amountLamports: bigint;
};

type LaunchCostInput = Pick<
  LaunchTokenInput,
  | "devWalletOption"
  | "importedDevWalletKey"
  | "devBuyAmountSol"
  | "jitoTipAmountSol"
  | "bundleBuyEnabled"
  | "vanityMint"
  | "bundlerWalletCount"
  | "bundlerBuyAmountSol"
  | "bundlerBuyVariancePercent"
  | "distributionWalletMultiplier"
  | "removeAttribution"
>;

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
    devWalletManaged: input.devWalletOption === "generate" || input.devWalletOption === "system",
    bundlerWallets: bundlerWalletKeypairs.map((wallet) =>
      wallet.publicKey.toBase58()
    ),
    distributionWallets: distributionWallets.map((wallet) =>
      wallet.wallet.publicKey.toBase58()
    ),
  };
}

function buildLaunchRecoveryWalletRows(
  launchId: string,
  input: LaunchTokenInput,
  mainWalletPublicKey: string,
  devWalletPublicKey: string,
  bundlerWalletKeypairs: Keypair[],
  distributionWallets: DistributionWallet[]
) {
  const rows: Prisma.LaunchRecoveryWalletCreateManyInput[] = [];
  if (devWalletPublicKey !== mainWalletPublicKey) {
    rows.push({
      launchId,
      walletPublicKey: devWalletPublicKey,
      walletType: "DEV",
      role: "DEV",
      isManaged: input.devWalletOption === "generate" || input.devWalletOption === "system",
    });
  }
  rows.push(
    ...bundlerWalletKeypairs.map((wallet) => ({
      launchId,
      walletPublicKey: wallet.publicKey.toBase58(),
      walletType: "BUNDLER" as const,
      role: "BUNDLER" as const,
      isManaged: true,
    }))
  );
  rows.push(
    ...distributionWallets.map((wallet) => ({
      launchId,
      walletPublicKey: wallet.wallet.publicKey.toBase58(),
      walletType: "DISTRIBUTION" as const,
      role: "DISTRIBUTION" as const,
      isManaged: true,
    }))
  );
  return rows;
}

async function persistLaunchRecoveryWallets(
  launchId: string,
  input: LaunchTokenInput,
  mainWalletPublicKey: string,
  devWalletPublicKey: string,
  bundlerWalletKeypairs: Keypair[],
  distributionWallets: DistributionWallet[]
) {
  const rows = buildLaunchRecoveryWalletRows(
    launchId,
    input,
    mainWalletPublicKey,
    devWalletPublicKey,
    bundlerWalletKeypairs,
    distributionWallets
  );
  await prisma.launchRecoveryWallet.deleteMany({ where: { launchId } });
  if (rows.length > 0) {
    await prisma.launchRecoveryWallet.createMany({ data: rows });
  }
}

async function persistLaunchRecoveryFundingSnapshot(
  launchId: string,
  fundedWallets: LaunchWalletFundingSnapshot[]
) {
  const fundedRows = fundedWallets.filter(
    (wallet) => wallet.fundedLamports > BigInt(0)
  );
  if (fundedRows.length === 0) {
    return;
  }

  await retryLaunchDbWrite(() =>
    prisma.$transaction(
      fundedRows.map((wallet) =>
        prisma.launchRecoveryWallet.updateMany({
          where: {
            launchId,
            walletPublicKey: wallet.publicKey,
          },
          data: {
            fundedLamports: wallet.fundedLamports.toString(),
          },
        })
      )
    )
  );
}

async function setLaunchRecovery(
  launchId: string,
  recovery: LaunchRecoveryData
) {
  await updateLaunchRecord(launchId, {
    result: { recovery },
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
    description: composeTokenDescription(input),
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

async function normalizeLaunchInputMediaForStorage(
  input: LaunchTokenInput
): Promise<LaunchTokenInput> {
  const normalizedInput: LaunchTokenInput = { ...input };
  const symbol = normalizeSymbol(input.tokenSymbol);

  if (normalizedInput.tokenImage.startsWith("data:")) {
    const uploadedMainMedia = await storageService.uploadImage(
      normalizedInput.tokenImage,
      symbol
    );
    if (uploadedMainMedia.startsWith("data:")) {
      throw new AppError(
        "Media storage is unavailable. Configure PINATA_JWT and retry.",
        500
      );
    }
    normalizedInput.tokenImage = uploadedMainMedia;
  }

  const trimmedBanner = normalizedInput.tokenBanner?.trim() ?? "";
  if (trimmedBanner.startsWith("data:")) {
    const uploadedBannerMedia = await storageService.uploadImage(
      trimmedBanner,
      `${symbol}-banner`
    );
    if (uploadedBannerMedia.startsWith("data:")) {
      throw new AppError(
        "Media storage is unavailable. Configure PINATA_JWT and retry.",
        500
      );
    }
    normalizedInput.tokenBanner = uploadedBannerMedia;
  }

  return normalizedInput;
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
  const logData: Prisma.LaunchLogUncheckedCreateInput = {
    launchId,
    level,
    message,
    step: step ?? null,
    ...(data === undefined ? {} : { data }),
  };
  await persistLaunchLog({
    ...logData,
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

async function appendBundleTelemetryLog(
  launchId: string,
  event: BundleTelemetryEvent
) {
  const shared = {
    source: "jito-bundle",
    eventType: event.type,
    ...event.data,
  } as Prisma.InputJsonObject;

  switch (event.type) {
    case "bundle_transactions_profiled":
      await appendLog(
        launchId,
        "INFO",
        "Bundle transactions profiled",
        "create",
        shared
      );
      await testRunLogService.appendServerEvent({
        eventType: "launch_step",
        source: "jito-bundle",
        action: "bundle.transactionsProfiled",
        launchId,
        status: "INFO",
        actualValue: shared,
      });
      return;
    case "bundle_tip_escalated":
      await appendLog(
        launchId,
        "WARN",
        "Adaptive bundle tip escalation applied",
        "create",
        shared
      );
      return;
    case "bundle_rebuild_triggered":
      await appendLog(
        launchId,
        "WARN",
        "Blockhash expired, rebuilding bundle",
        "create",
        shared
      );
      return;
    case "bundle_rebuilt":
      await appendLog(
        launchId,
        "INFO",
        "Bundle rebuilt and resent",
        "create",
        shared
      );
      return;
    case "bundle_resend_triggered":
      await appendLog(
        launchId,
        "WARN",
        "Bundle resend triggered",
        "create",
        shared
      );
      return;
    case "bundle_status_check_error":
      await appendLog(
        launchId,
        "WARN",
        "Bundle status check error",
        "create",
        shared
      );
      return;
    case "bundle_confirm_timeout":
      await appendLog(
        launchId,
        "ERROR",
        "Bundle confirmation timed out before create landed",
        "create",
        shared
      );
      return;
    case "bundle_confirm_summary":
      await appendLog(
        launchId,
        "INFO",
        "Bundle confirmation summary",
        "create",
        shared
      );
      return;
    case "bundle_sent":
      await appendLog(launchId, "INFO", "Jito bundle sent", "create", shared);
      return;
    case "bundle_resent":
      await appendLog(launchId, "INFO", "Bundle resent", "create", shared);
      return;
    default:
      return;
  }
}

async function updateLaunchRecord(
  launchId: string,
  data: Prisma.XOR<Prisma.LaunchUpdateInput, Prisma.LaunchUncheckedUpdateInput>,
  options?: { bestEffort?: boolean; context?: Record<string, unknown> }
) {
  try {
    return await retryLaunchDbWrite(() =>
      prisma.launch.update({
        where: { id: launchId },
        data,
      })
    );
  } catch (error) {
    if (!options?.bestEffort) {
      throw error;
    }

    logger.warn("Best-effort launch update failed", {
      launchId,
      message: getErrorMessage(error),
      ...(options.context ?? {}),
    });
    return null;
  }
}

async function updateProgress(
  launchId: string,
  progress: number,
  currentStep?: string
) {
  await updateLaunchRecord(
    launchId,
    {
      progress,
      currentStep,
    },
    {
      bestEffort: true,
      context: {
        progress,
        currentStep: currentStep ?? null,
      },
    }
  );
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
  await updateLaunchRecord(launch.id, {
    status: "FAILED",
    errorMessage,
    completedAt,
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

const VANITY_MINT_ASSIGNMENT_MAX_ATTEMPTS = 3;

async function reserveVanityMint(userId: string, excludedIds: string[] = []) {
  const where: Prisma.VanityMintWhereInput = {
    reservedAt: null,
    usedAt: null,
    tokenPublicKey: null,
    ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
  };

  for (
    let attempt = 0;
    attempt < VANITY_MINT_ASSIGNMENT_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const availableCount = await prisma.vanityMint.count({ where });
    if (availableCount === 0) {
      return null;
    }

    const randomOffset = Math.floor(Math.random() * availableCount);
    const candidate = await prisma.vanityMint.findFirst({
      where,
      orderBy: { id: "asc" },
      skip: randomOffset,
      select: { id: true, publicKey: true, privateKey: true },
    });

    if (!candidate) {
      continue;
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

async function consumeReservedVanityMint(
  vanityMintId: string,
  tokenPublicKey: string
) {
  await prisma.vanityMint.updateMany({
    where: {
      id: vanityMintId,
      reservedAt: { not: null },
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
      tokenPublicKey,
    },
  });
}

async function releaseReservedVanityMint(vanityMintId: string) {
  await prisma.vanityMint.updateMany({
    where: {
      id: vanityMintId,
      reservedAt: { not: null },
      usedAt: null,
    },
    data: {
      reservedAt: null,
      userId: null,
      tokenPublicKey: null,
    },
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

async function waitForMintAccount(
  mintPublicKey: string,
  launchId?: string,
  useGrpc = true
) {
  const {
    mintConfirmTimeoutMs: MINT_CONFIRM_TIMEOUT_MS,
    mintConfirmIntervalMs: MINT_CONFIRM_INTERVAL_MS,
  } = getLaunchConfig();
  const connection = getSolanaConnection();
  const mintKey = new PublicKey(mintPublicKey);
  const startedAt = Date.now();
  const subscriptionId = launchId
    ? `launch:${launchId}`
    : `launch:${mintPublicKey}`;

  type MintResult = {
    source: "grpc" | "rpc";
    attempts: number;
    durationMs: number;
    owner: string;
    lamports: number;
    dataLength: number;
  };

  const grpcPromise = new Promise<MintResult>((resolve) => {
    if (!useGrpc || !grpcManager.isConnected()) {
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

function getSystemDevWalletKeypair(): Keypair {
  const { SYSTEM_DEV_WALLET_PRIVATE_KEY } = getEnv();
  return keypairFromPrivateKey(SYSTEM_DEV_WALLET_PRIVATE_KEY);
}

async function mintAccountExistsOnChain(mint: PublicKey) {
  try {
    const connection = getSolanaConnection();
    const accountInfo = await connection.getAccountInfo(mint, "confirmed");
    return Boolean(accountInfo);
  } catch (error) {
    logger.warn("Vanity mint precheck failed", {
      mint: mint.toBase58(),
      message: getErrorMessage(error),
    });
    return false;
  }
}

function requiredBuyLamportsFromLamports(
  amountLamports: bigint,
  extraBufferLamports = 0,
  rentLamports = BigInt(0)
) {
  const {
    fundingBufferLamports: FUNDING_BUFFER_LAMPORTS,
    transferFeeBufferLamports: TRANSFER_FEE_BUFFER_LAMPORTS,
  } = getLaunchConfig();
  if (amountLamports <= BigInt(0)) {
    return BigInt(0);
  }
  return (
    amountLamports +
    BigInt(FUNDING_BUFFER_LAMPORTS + TRANSFER_FEE_BUFFER_LAMPORTS) +
    BigInt(extraBufferLamports) +
    rentLamports
  );
}

function requiredBuyLamports(
  amountSol: number,
  extraBufferLamports = 0,
  rentLamports = BigInt(0)
) {
  return requiredBuyLamportsFromLamports(
    toLamports(amountSol),
    extraBufferLamports,
    rentLamports
  );
}

async function fundWalletsFromMain(
  launchId: string,
  mainWalletKeypair: Keypair,
  targets: { publicKey: PublicKey; requiredLamports: bigint }[],
  mainReserveLamports: bigint,
  userId?: string
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
      fundedWallets: [] as LaunchWalletFundingSnapshot[],
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
  const currentBalanceByPublicKey = new Map(
    uniqueTargets.map((target, index) => [
      target.publicKey.toBase58(),
      targetBalances[index] ?? 0,
    ])
  );

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
      fundedWallets: [] as LaunchWalletFundingSnapshot[],
    };
  }

  const totalLamports = fundingPlan.reduce(
    (total, target) => total + target.topUpLamports,
    BigInt(0)
  );
  const fundedWallets = fundingPlan.map((target) => ({
    publicKey: target.publicKey.toBase58(),
    fundedLamports: target.topUpLamports,
  }));

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
    const fundTrackIds: string[] = [];
    if (userId) {
      for (const target of batch) {
        const id = await appTransactionService
          .create({
            userId,
            type: "TRANSFER_FUND",
            source: "LAUNCH",
            walletPublicKey: mainWalletKeypair.publicKey.toBase58(),
            fromAddress: mainWalletKeypair.publicKey.toBase58(),
            toAddress: target.publicKey.toBase58(),
            solAmount: Number(target.topUpLamports) / 1_000_000_000,
            referenceId: launchId,
          })
          .then((r) => r.id)
          .catch(() => null);
        if (id) fundTrackIds.push(id);
      }
    }
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [mainWalletKeypair],
      { commitment: "confirmed" }
    );
    if (fundTrackIds.length > 0) await appTransactionService.confirmMany(fundTrackIds, { signature }).catch(() => {});
    await testRunLogService.appendServerEvent({
      eventType: "wallet_transaction",
      source: "launch.service",
      action: "launch.fundWalletBatch",
      launchId,
      wallets: [
        mainWalletKeypair.publicKey.toBase58(),
        ...batch.map((target) => target.publicKey.toBase58()),
      ],
      signature,
      status: "submitted",
      actualValue: {
        batchSize: batch.length,
        batchLamports: batch
          .reduce((sum, target) => sum + target.topUpLamports, BigInt(0))
          .toString(),
      },
    });
    signatures.push(signature);
  }

  const [mainBalanceAfter, ...targetBalancesAfter] = await Promise.all([
    connection.getBalance(mainWalletKeypair.publicKey, "confirmed"),
    ...fundingPlan.map((target) =>
      connection.getBalance(target.publicKey, "confirmed")
    ),
  ]);

  await appendLog(launchId, "INFO", "Wallets funded", "funding", {
    fundedCount: fundingPlan.length,
    totalLamports: totalLamports.toString(),
    totalSol: lamportsToSol(totalLamports).toFixed(4),
    transactions: signatures.length,
    signatures,
    reserveSol: lamportsToSol(mainReserveLamports).toFixed(4),
    durationMs: Date.now() - startedAt,
  });

  await testRunLogService.appendServerEvent({
    eventType: "wallet_balance_snapshot",
    source: "launch.service",
    action: "launch.funding",
    launchId,
    balancesBefore: [
      {
        walletPublicKey: mainWalletKeypair.publicKey.toBase58(),
        role: "main",
        balanceSol: mainBalance / LAMPORTS_PER_SOL,
        dataSource: "rpc",
      },
      ...fundingPlan.map((target) => ({
        walletPublicKey: target.publicKey.toBase58(),
        role: "launch-wallet",
        balanceSol:
          (currentBalanceByPublicKey.get(target.publicKey.toBase58()) ?? 0) /
          LAMPORTS_PER_SOL,
        topUpLamports: target.topUpLamports.toString(),
        dataSource: "rpc",
      })),
    ],
    balancesAfter: [
      {
        walletPublicKey: mainWalletKeypair.publicKey.toBase58(),
        role: "main",
        balanceSol: mainBalanceAfter / LAMPORTS_PER_SOL,
        dataSource: "rpc",
      },
      ...fundingPlan.map((target, index) => ({
        walletPublicKey: target.publicKey.toBase58(),
        role: "launch-wallet",
        balanceSol: (targetBalancesAfter[index] ?? 0) / LAMPORTS_PER_SOL,
        topUpLamports: target.topUpLamports.toString(),
        dataSource: "rpc",
      })),
    ],
    summary: {
      fundedCount: fundingPlan.length,
      totalLamports: totalLamports.toString(),
      signatureCount: signatures.length,
      reserveLamports: mainReserveLamports.toString(),
    },
  });

  return {
    fundedCount: fundingPlan.length,
    totalLamports,
    signatures,
    fundedWallets,
  };
}

function validateLaunchInput(input: LaunchCostInput) {
  const {
    minBuyAmountSol: MIN_BUY_AMOUNT_SOL,
    maxBundleWallets: MAX_BUNDLE_WALLETS,
  } = getLaunchConfig();
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
  if (
    bundlerBuyAmountSol > 0 &&
    bundlerBuyAmountSol < MIN_BUNDLER_BUY_AMOUNT_SOL
  ) {
    throw new AppError(
      `Buy amount per wallet must be at least ${MIN_BUNDLER_BUY_AMOUNT_SOL} SOL`,
      400
    );
  }
  if (input.bundleBuyEnabled && bundlerWalletCount > MAX_BUNDLE_WALLETS) {
    throw new AppError(
      `Bundle buy supports up to ${MAX_BUNDLE_WALLETS} wallets per launch`,
      400
    );
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

type LaunchFundingPlan = {
  fundingTargets: { publicKey: PublicKey; requiredLamports: bigint }[];
  mainReserveLamports: bigint;
  tipLamports: bigint;
  devFundingLamports: bigint;
  bundlerFundingTargetLamports: bigint[];
  totalBundlerFundingLamports: bigint;
  totalBundleBuyLamports: bigint;
  creatorTargetLamports: bigint;
  ataRentLamports: bigint;
  userVolumeAccumulatorRentLamports: bigint;
  buyRentLamports: bigint;
  distributionAtaLamports: bigint;
};

type LaunchCostPreview = {
  platformFeeWaived: boolean;
  platformFeeDiscountRate: number;
  mainWalletBalanceSol: number;
  mainWalletBalanceLamports: string;
  requiredMainWalletSol: number;
  requiredMainWalletLamports: string;
  hasSufficientMainWallet: boolean;
  chargedNowSol: number;
  temporaryFundingSol: number;
  expectedReturnSol: number;
  permanentSpendSol: number;
  netMainWalletDeltaNowSol: number;
  netMainWalletDeltaAfterCleanupSol: number;
  lineItems: {
    usageFeesSol: number;
    descriptionAttributionRemovalFeeSol: number;
    bundleBuyFeeSol: number;
    vanityMintFeeSol: number;
    generatedWalletFeeSol: number;
    nonSystemDevWalletFeeSol: number;
    devBuySol: number;
    bundleBuyBaseSol: number;
    bundleBuyMaxSol: number;
    bundleBuyVarianceReserveSol: number;
    creatorReserveSol: number;
    jitoTipSol: number;
    walletFundingTopUpSol: number;
    mainReserveSol: number;
    buyWalletReserveSol: number;
    creatorTargetSol: number;
    devFundingSol: number;
    bundlerFundingPerWalletSol: number;
    totalBundlerFundingSol: number;
    transferReserveSol: number;
    ataRentSol: number;
    userVolumeAccumulatorRentSol: number;
    buyRentPerWalletSol: number;
    distributionAtaPerBundlerSol: number;
    totalDistributionAtaSol: number;
  };
};

async function buildLaunchFundingPlan(params: {
  input: LaunchCostInput;
  bundlerWalletCount: number;
  bundlerBuyAmountSol: number;
  bundlerBuyVariancePercent: number;
  distributionWalletMultiplier: number;
  devBuyAmountSol: number;
  jitoTipAmountSol: number;
  mainWalletPublicKey: string;
  devWalletPublicKey: string;
  bundlerWalletPublicKeys: PublicKey[];
  bundlerBuyAmountLamportsByWallet?: bigint[];
  allocationSeed?: string;
  createFeeBufferLamports: number;
  minCreatorBalanceLamports: bigint;
}) {
  const connection = getSolanaConnection();
  const ataRentLamports = BigInt(
    await connection.getMinimumBalanceForRentExemption(165)
  );
  const userVolumeAccumulatorRentLamports = BigInt(
    await connection.getMinimumBalanceForRentExemption(74)
  );
  const buyRentLamports = ataRentLamports + userVolumeAccumulatorRentLamports;
  const distributionWalletsPerBundler =
    params.distributionWalletMultiplier > 1
      ? params.distributionWalletMultiplier - 1
      : 0;
  const distributionAtaLamports =
    distributionWalletsPerBundler > 0
      ? ataRentLamports * BigInt(distributionWalletsPerBundler)
      : BigInt(0);
  const totalBundleBuyLamports = params.input.bundleBuyEnabled
    ? toLamports(params.bundlerWalletCount * params.bundlerBuyAmountSol)
    : BigInt(0);
  const bundlerBuyAmountLamportsByWallet =
    params.input.bundleBuyEnabled && params.bundlerWalletPublicKeys.length > 0
      ? (params.bundlerBuyAmountLamportsByWallet ??
        allocateFixedTotalBundleLamports({
          walletCount: params.bundlerWalletPublicKeys.length,
          totalLamports: totalBundleBuyLamports,
          targetLamportsPerWallet: toLamports(params.bundlerBuyAmountSol),
          variancePercent: params.bundlerBuyVariancePercent,
          minLamportsPerWallet: MIN_BUNDLER_BUY_AMOUNT_LAMPORTS,
          seed:
            params.allocationSeed ??
            `preview:${params.bundlerWalletCount}:${params.bundlerBuyAmountSol}:${params.bundlerBuyVariancePercent}`,
        }).amountLamportsByWallet)
      : [];
  const requiredCreatorLamports = requiredBuyLamports(
    params.devBuyAmountSol,
    params.createFeeBufferLamports,
    buyRentLamports
  );
  const creatorTargetLamports =
    requiredCreatorLamports > params.minCreatorBalanceLamports
      ? requiredCreatorLamports
      : params.minCreatorBalanceLamports;
  const devFundingLamports =
    params.devWalletPublicKey === params.mainWalletPublicKey
      ? BigInt(0)
      : creatorTargetLamports;
  const bundlerFundingTargetLamports = bundlerBuyAmountLamportsByWallet.map(
    (buyAmountLamports) =>
      requiredBuyLamportsFromLamports(
        buyAmountLamports,
        0,
        buyRentLamports + distributionAtaLamports
      )
  );
  const totalBundlerFundingLamports = bundlerFundingTargetLamports.reduce(
    (total, lamports) => total + lamports,
    BigInt(0)
  );
  const tipLamports = params.input.bundleBuyEnabled
    ? BigInt(Math.floor(params.jitoTipAmountSol * LAMPORTS_PER_SOL))
    : BigInt(0);
  const mainReserveLamports =
    tipLamports +
    (params.devWalletPublicKey === params.mainWalletPublicKey
      ? creatorTargetLamports
      : BigInt(0));
  const fundingTargets = [
    ...(devFundingLamports > BigInt(0)
      ? [
          {
            publicKey: new PublicKey(params.devWalletPublicKey),
            requiredLamports: devFundingLamports,
          },
        ]
      : []),
    ...params.bundlerWalletPublicKeys.map((publicKey, index) => ({
      publicKey,
      requiredLamports: bundlerFundingTargetLamports[index] ?? BigInt(0),
    })),
  ];

  return {
    fundingTargets,
    mainReserveLamports,
    tipLamports,
    devFundingLamports,
    bundlerFundingTargetLamports,
    totalBundlerFundingLamports,
    totalBundleBuyLamports,
    creatorTargetLamports,
    ataRentLamports,
    userVolumeAccumulatorRentLamports,
    buyRentLamports,
    distributionAtaLamports,
  } satisfies LaunchFundingPlan;
}

async function resolvePreflightDevWalletBalance(params: {
  input: LaunchCostInput;
  mainWalletPublicKey: string;
}) {
  if (params.input.devWalletOption === "system") {
    const systemKeypair = getSystemDevWalletKeypair();
    return {
      devWalletPublicKey: systemKeypair.publicKey.toBase58(),
      currentLamports: BigInt(0),
    };
  }

  if (params.input.devWalletOption === "use_main") {
    return {
      devWalletPublicKey: params.mainWalletPublicKey,
      currentLamports: BigInt(0),
    };
  }

  if (params.input.devWalletOption === "generate") {
    return {
      devWalletPublicKey: Keypair.generate().publicKey.toBase58(),
      currentLamports: BigInt(0),
    };
  }

  if (!params.input.importedDevWalletKey?.trim()) {
    throw new AppError("Dev wallet private key is required", 400);
  }

  const devWalletKeypair = keypairFromPrivateKey(
    params.input.importedDevWalletKey.trim()
  );
  const devWalletPublicKey = devWalletKeypair.publicKey.toBase58();
  if (devWalletPublicKey === params.mainWalletPublicKey) {
    return { devWalletPublicKey, currentLamports: BigInt(0) };
  }

  const connection = getSolanaConnection();
  const currentLamports = BigInt(
    await connection.getBalance(devWalletKeypair.publicKey, "confirmed")
  );

  return { devWalletPublicKey, currentLamports };
}

async function ensureLaunchFundingAvailable(
  input: LaunchCostInput,
  user: RequestUser
) {
  const preview = await calculateLaunchCostPreview(input, user);
  if (!preview.hasSufficientMainWallet) {
    throw new AppError(
      `Main wallet requires ${preview.requiredMainWalletSol.toFixed(4)} SOL to fund launch wallets and usage fees`,
      400
    );
  }
}

async function calculateLaunchCostPreview(
  input: LaunchCostInput,
  user: RequestUser
): Promise<LaunchCostPreview> {
  const {
    bundlerWalletCount,
    bundlerBuyAmountSol,
    bundlerBuyVariancePercent,
    devBuyAmountSol,
    distributionWalletMultiplier,
    jitoTipAmountSol,
  } = validateLaunchInput(input);
  const {
    createFeeBufferLamports: CREATE_FEE_BUFFER_LAMPORTS,
    fundingBufferLamports: FUNDING_BUFFER_LAMPORTS,
    minCreatorBalanceLamports: MIN_CREATOR_BALANCE_LAMPORTS,
    transferFeeBufferLamports: TRANSFER_FEE_BUFFER_LAMPORTS,
  } = getLaunchConfig();
  const dbUser = await loadUserWithMainWallet(user.id);
  const connection = getSolanaConnection();
  const mainWalletPublicKey = dbUser.mainWallet.publicKey;
  const { devWalletPublicKey, currentLamports: importedDevCurrentLamports } =
    await resolvePreflightDevWalletBalance({
      input,
      mainWalletPublicKey,
    });
  const bundlerWalletPublicKeys =
    input.bundleBuyEnabled && bundlerWalletCount > 0
      ? Array.from(
          { length: bundlerWalletCount },
          () => Keypair.generate().publicKey
        )
      : [];
  const fundingPlan = await buildLaunchFundingPlan({
    input,
    bundlerWalletCount,
    bundlerBuyAmountSol,
    bundlerBuyVariancePercent,
    distributionWalletMultiplier,
    devBuyAmountSol,
    jitoTipAmountSol,
    mainWalletPublicKey,
    devWalletPublicKey,
    bundlerWalletPublicKeys,
    createFeeBufferLamports: CREATE_FEE_BUFFER_LAMPORTS,
    minCreatorBalanceLamports: MIN_CREATOR_BALANCE_LAMPORTS,
  });
  const mainBalanceLamports = BigInt(
    await connection.getBalance(new PublicKey(mainWalletPublicKey), "confirmed")
  );
  const usageFees = applyLaunchFeePolicy(input, user);
  const usageFeeLamports = BigInt(toLamports(usageFees.totalFeeSol));
  const totalLamports = fundingPlan.fundingTargets.reduce((total, target) => {
    const currentLamports =
      target.publicKey.toBase58() === devWalletPublicKey
        ? importedDevCurrentLamports
        : BigInt(0);
    const topUpLamports = target.requiredLamports - currentLamports;
    return topUpLamports > BigInt(0) ? total + topUpLamports : total;
  }, BigInt(0));
  const requiredMainLamports =
    totalLamports + fundingPlan.mainReserveLamports + usageFeeLamports;
  const requiredCreatorLamports = requiredBuyLamports(
    devBuyAmountSol,
    CREATE_FEE_BUFFER_LAMPORTS,
    fundingPlan.buyRentLamports
  );
  const creatorFloorExtraLamports =
    fundingPlan.creatorTargetLamports > requiredCreatorLamports
      ? fundingPlan.creatorTargetLamports - requiredCreatorLamports
      : BigInt(0);
  const creatorReserveLamports =
    BigInt(CREATE_FEE_BUFFER_LAMPORTS + FUNDING_BUFFER_LAMPORTS) +
    creatorFloorExtraLamports;
  const buyWalletReserveLamports = input.bundleBuyEnabled
    ? BigInt(FUNDING_BUFFER_LAMPORTS * bundlerWalletCount)
    : BigInt(0);
  const transferReserveLamports = BigInt(
    TRANSFER_FEE_BUFFER_LAMPORTS *
      (1 + (input.bundleBuyEnabled ? bundlerWalletCount : 0))
  );
  const bundleBuyBaseSol = lamportsToSol(fundingPlan.totalBundleBuyLamports);
  const bundleBuyMaxSol = bundleBuyBaseSol;
  const bundleBuyVarianceReserveSol = 0;
  const jitoTipSol = input.bundleBuyEnabled ? jitoTipAmountSol : 0;
  const expectedReturnLamports = totalLamports
    ? totalLamports -
      toLamports(devBuyAmountSol) -
      fundingPlan.totalBundleBuyLamports
    : BigInt(0);
  const expectedReturnSol = Math.max(0, lamportsToSol(expectedReturnLamports));
  const chargedNowSol = lamportsToSol(requiredMainLamports);
  const permanentSpendSol =
    usageFees.totalFeeSol + devBuyAmountSol + bundleBuyBaseSol + jitoTipSol;

  return {
    platformFeeWaived: usageFees.platformFeeWaived,
    platformFeeDiscountRate: usageFees.platformFeeDiscountRate,
    mainWalletBalanceSol: lamportsToSol(mainBalanceLamports),
    mainWalletBalanceLamports: mainBalanceLamports.toString(),
    requiredMainWalletSol: lamportsToSol(requiredMainLamports),
    requiredMainWalletLamports: requiredMainLamports.toString(),
    hasSufficientMainWallet: mainBalanceLamports >= requiredMainLamports,
    chargedNowSol,
    temporaryFundingSol: lamportsToSol(totalLamports),
    expectedReturnSol,
    permanentSpendSol,
    netMainWalletDeltaNowSol: chargedNowSol,
    netMainWalletDeltaAfterCleanupSol: Math.max(
      0,
      chargedNowSol - expectedReturnSol
    ),
    lineItems: {
      usageFeesSol: usageFees.totalFeeSol,
      descriptionAttributionRemovalFeeSol:
        usageFees.descriptionAttributionRemovalFeeSol,
      bundleBuyFeeSol: usageFees.bundleBuyFeeSol,
      vanityMintFeeSol: usageFees.vanityMintFeeSol,
      generatedWalletFeeSol: usageFees.generatedWalletFeeSol,
      nonSystemDevWalletFeeSol: usageFees.nonSystemDevWalletFeeSol,
      devBuySol: devBuyAmountSol,
      bundleBuyBaseSol,
      bundleBuyMaxSol,
      bundleBuyVarianceReserveSol,
      creatorReserveSol: lamportsToSol(creatorReserveLamports),
      jitoTipSol,
      walletFundingTopUpSol: lamportsToSol(totalLamports),
      mainReserveSol: lamportsToSol(fundingPlan.mainReserveLamports),
      buyWalletReserveSol: lamportsToSol(buyWalletReserveLamports),
      creatorTargetSol: lamportsToSol(fundingPlan.creatorTargetLamports),
      devFundingSol: lamportsToSol(fundingPlan.devFundingLamports),
      bundlerFundingPerWalletSol:
        bundlerWalletCount > 0
          ? lamportsToSol(fundingPlan.totalBundlerFundingLamports) /
            bundlerWalletCount
          : 0,
      totalBundlerFundingSol: lamportsToSol(
        fundingPlan.totalBundlerFundingLamports
      ),
      transferReserveSol: lamportsToSol(transferReserveLamports),
      ataRentSol: lamportsToSol(fundingPlan.ataRentLamports),
      userVolumeAccumulatorRentSol: lamportsToSol(
        fundingPlan.userVolumeAccumulatorRentLamports
      ),
      buyRentPerWalletSol: lamportsToSol(fundingPlan.buyRentLamports),
      distributionAtaPerBundlerSol: lamportsToSol(
        fundingPlan.distributionAtaLamports
      ),
      totalDistributionAtaSol: lamportsToSol(
        fundingPlan.distributionAtaLamports * BigInt(bundlerWalletCount)
      ),
    },
  };
}

async function resolveDevWallet(
  input: LaunchTokenInput,
  userId: string,
  mainWalletKeypair: Keypair,
  mainWalletPublicKey: string
) {
  let devWalletKeypair = mainWalletKeypair;
  let devWalletPublicKey = mainWalletPublicKey;

  if (input.devWalletOption === "system") {
    devWalletKeypair = getSystemDevWalletKeypair();
    devWalletPublicKey = devWalletKeypair.publicKey.toBase58();
    await prisma.wallet.upsert({
      where: { publicKey: devWalletPublicKey },
      update: {},
      create: {
        publicKey: devWalletPublicKey,
        privateKey: "",
        type: "DEV",
        isSystemWallet: true,
      },
    });
  }

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
    const devWalletPrivateKey = bs58.encode(devWalletKeypair.secretKey);
    await persistGeneratedPrivateKey({
      service: "launchService",
      operation: "resolveDevWallet.generate",
      publicKey: devWalletPublicKey,
      privateKey: devWalletPrivateKey,
    });
    await prisma.wallet.create({
      data: {
        publicKey: devWalletPublicKey,
        privateKey: devWalletPrivateKey,
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
  const persistedBundlerWallets = bundlerWalletKeypairs.map((wallet) => ({
    publicKey: wallet.publicKey.toBase58(),
    privateKey: bs58.encode(wallet.secretKey),
  }));
  await Promise.all(
    persistedBundlerWallets.map((wallet) =>
      persistGeneratedPrivateKey({
        service: "launchService",
        operation: "ensureBundlerWallets",
        publicKey: wallet.publicKey,
        privateKey: wallet.privateKey,
      })
    )
  );
  await prisma.wallet.createMany({
    data: persistedBundlerWallets.map((wallet) => ({
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
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
  const persistedDistributionWallets = distributionWallets.map((wallet) => ({
    publicKey: wallet.wallet.publicKey.toBase58(),
    privateKey: bs58.encode(wallet.wallet.secretKey),
  }));
  await Promise.all(
    persistedDistributionWallets.map((wallet) =>
      persistGeneratedPrivateKey({
        service: "launchService",
        operation: "ensureDistributionWallets",
        publicKey: wallet.publicKey,
        privateKey: wallet.privateKey,
      })
    )
  );
  await prisma.wallet.createMany({
    data: persistedDistributionWallets.map((wallet) => ({
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
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
  await updateLaunchRecord(launchId, {
    status: "CANCELED",
    completedAt: new Date(),
  });
  return true;
}

async function reserveMintIfRequested(
  launchId: string,
  userId: string,
  vanityRequested: boolean
) {
  if (!vanityRequested) {
    const mintKeypair = Keypair.generate();
    const mintPublicKey = mintKeypair.publicKey.toBase58();
    const mintPrivateKey = bs58.encode(mintKeypair.secretKey);
    await persistGeneratedPrivateKey({
      service: "launchService",
      operation: "reserveMintIfRequested.generate",
      publicKey: mintPublicKey,
      privateKey: mintPrivateKey,
    });
    return { mintKeypair, reservedVanityId: null };
  }

  const attemptedVanityIds: string[] = [];
  for (
    let attempt = 1;
    attempt <= VANITY_MINT_ASSIGNMENT_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const reserved = await reserveVanityMint(userId, attemptedVanityIds);
    if (!reserved) {
      break;
    }
    attemptedVanityIds.push(reserved.id);

    let mintKeypair: Keypair;
    try {
      mintKeypair = keypairFromPrivateKey(reserved.privateKey);
    } catch {
      await releaseReservedVanityMint(reserved.id);
      await appendLog(
        launchId,
        "WARN",
        "Skipping vanity mint with invalid private key",
        "mint",
        {
          vanityMintId: reserved.id,
          publicKey: reserved.publicKey,
          attempt,
          maxAttempts: VANITY_MINT_ASSIGNMENT_MAX_ATTEMPTS,
        }
      );
      continue;
    }

    const mintPublicKey = mintKeypair.publicKey.toBase58();
    if (mintPublicKey !== reserved.publicKey) {
      await releaseReservedVanityMint(reserved.id);
      await appendLog(
        launchId,
        "WARN",
        "Skipping vanity mint with mismatched public key",
        "mint",
        {
          vanityMintId: reserved.id,
          expectedPublicKey: reserved.publicKey,
          derivedPublicKey: mintPublicKey,
          attempt,
          maxAttempts: VANITY_MINT_ASSIGNMENT_MAX_ATTEMPTS,
        }
      );
      continue;
    }

    const existsOnChain = await mintAccountExistsOnChain(mintKeypair.publicKey);
    if (existsOnChain) {
      await releaseReservedVanityMint(reserved.id);
      await appendLog(
        launchId,
        "WARN",
        "Skipping vanity mint already present on-chain",
        "mint",
        {
          vanityMintId: reserved.id,
          publicKey: reserved.publicKey,
          attempt,
          maxAttempts: VANITY_MINT_ASSIGNMENT_MAX_ATTEMPTS,
        }
      );
      continue;
    }

    await appendLog(launchId, "INFO", "Using vanity mint", "mint", {
      vanityMintId: reserved.id,
      publicKey: reserved.publicKey,
      attempt,
      maxAttempts: VANITY_MINT_ASSIGNMENT_MAX_ATTEMPTS,
    });
    return {
      mintKeypair,
      reservedVanityId: reserved.id,
    };
  }

  throw new AppError(
    "Error assigning vanity mint. Try disabling vanity mint.",
    400
  );
}

function buildBundlerBuyTargets(
  wallets: Keypair[],
  bundlerBuyAmountSol: number,
  bundlerBuyVariancePercent: number,
  seed: string
) {
  const allocation = allocateFixedTotalBundleLamports({
    walletCount: wallets.length,
    totalLamports: toLamports(wallets.length * bundlerBuyAmountSol),
    targetLamportsPerWallet: toLamports(bundlerBuyAmountSol),
    variancePercent: bundlerBuyVariancePercent,
    minLamportsPerWallet: MIN_BUNDLER_BUY_AMOUNT_LAMPORTS,
    seed,
  });

  return {
    ...allocation,
    targets: wallets.map((wallet, index) => ({
      wallet,
      amountLamports: allocation.amountLamportsByWallet[index] ?? BigInt(0),
    })) satisfies BundlerBuyTarget[],
  };
}

async function distributeTokensToWallets(
  launchId: string,
  mint: PublicKey,
  bundlerWalletKeypairs: Keypair[],
  distributionWallets: DistributionWallet[],
  distributionWalletMultiplier: number,
  userId?: string
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
        const distTrackId = userId
          ? await appTransactionService.create({
              userId,
              type: "TOKEN_DISTRIBUTE",
              source: "LAUNCH",
              tokenPublicKey: mint.toBase58(),
              walletPublicKey: sourceWallet.publicKey.toBase58(),
              fromAddress: sourceWallet.publicKey.toBase58(),
              toAddress: destination.publicKey.toBase58(),
              referenceId: launchId,
            }).then((r) => r.id).catch(() => null)
          : null;
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [sourceWallet],
          { commitment: "confirmed" }
        );
        if (distTrackId) await appTransactionService.confirm(distTrackId, { signature }).catch(() => {});
        await testRunLogService.appendServerEvent({
          eventType: "wallet_transaction",
          source: "launch.service",
          action: "launch.distributionTransfer",
          launchId,
          wallets: [
            sourceWallet.publicKey.toBase58(),
            destination.publicKey.toBase58(),
          ],
          signature,
          status: "submitted",
          actualValue: {
            amountRaw: amountPerWallet.toString(),
          },
        });
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

async function persistTokenPending(
  input: LaunchTokenInput,
  tokenImageUrl: string | null,
  userId: string,
  mintPublicKey: string,
  mintPrivateKey: string,
  devWalletPublicKey: string,
  bundlerWalletKeypairs: Keypair[],
  distributionWallets: DistributionWallet[],
  reservedVanityId: string | null
) {
  let distributionWalletCount = 0;
  const token = await prisma.$transaction(
    async (tx) => {
      const createdToken = await tx.token.create({
        data: {
          publicKey: mintPublicKey,
          privateKey: mintPrivateKey,
          status: "PENDING",
          name: input.tokenName.trim(),
          symbol: normalizeSymbol(input.tokenSymbol),
          description: composeTokenDescription(input) || null,
          imageUrl: tokenImageUrl,
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

async function activateToken(tokenPublicKey: string) {
  return await retryLaunchDbWrite(() =>
    prisma.token.update({
      where: { publicKey: tokenPublicKey },
      data: { status: "ACTIVE" },
    })
  );
}

async function failToken(tokenPublicKey: string) {
  return await retryLaunchDbWrite(() =>
    prisma.token.update({
      where: { publicKey: tokenPublicKey },
      data: { status: "FAILED" },
    })
  );
}

async function returnExcessSolToMain(
  launchId: string,
  mainWalletKeypair: Keypair,
  sourceWallets: Keypair[],
  userId?: string,
  tokenPublicKey?: string
) {
  const { transferFeeBufferLamports: TRANSFER_FEE_BUFFER_LAMPORTS } =
    getLaunchConfig();
  const startedAt = Date.now();
  const connection = getSolanaConnection();
  const mainWalletPublicKey = mainWalletKeypair.publicKey.toBase58();
  const mainPublicKey = new PublicKey(mainWalletPublicKey);
  const rentExemptReserveLamports =
    await connection.getMinimumBalanceForRentExemption(0);
  const uniqueSourceWallets = sourceWallets.filter(
    (wallet, index, all) =>
      !wallet.publicKey.equals(mainPublicKey) &&
      all.findIndex((item) => item.publicKey.equals(wallet.publicKey)) === index
  );

  if (uniqueSourceWallets.length === 0) {
    return {
      attempted: 0,
      returned: 0,
      failed: 0,
      skipped: 0,
      totalReturnedSol: 0,
      results: [] as SolReturnResult[],
      durationMs: Date.now() - startedAt,
    };
  }

  const sourceBalances = await Promise.all(
    uniqueSourceWallets.map((wallet) => connection.getBalance(wallet.publicKey))
  );
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const sponsoredFeeTransaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: uniqueSourceWallets[0].publicKey,
      toPubkey: mainPublicKey,
      lamports: 1,
    })
  );
  sponsoredFeeTransaction.recentBlockhash = blockhash;
  sponsoredFeeTransaction.feePayer = mainPublicKey;
  const [mainWalletBalanceLamports, sponsoredFee] = await Promise.all([
    connection.getBalance(mainPublicKey),
    connection.getFeeForMessage(
      sponsoredFeeTransaction.compileMessage(),
      "confirmed"
    ),
  ]);
  const sponsoredFeeLamports = sponsoredFee.value ?? 5000;
  const reclaimMode = resolveBatchReclaimMode({
    mainWalletBalanceLamports,
    walletBalancesLamports: sourceBalances,
    sponsoredFeeLamports,
  });
  const results: SolReturnResult[] = [];
  let totalReturnedLamports = BigInt(0);
  for (const [index, sourceWallet] of uniqueSourceWallets.entries()) {
    const balanceLamports = sourceBalances[index] ?? 0;
    const lamportsToSend =
      reclaimMode === "main-sponsored"
        ? computeSponsoredRecoverableLamports({
            balanceLamports,
            feeLamports: sponsoredFeeLamports,
          })
        : balanceLamports -
          TRANSFER_FEE_BUFFER_LAMPORTS -
          rentExemptReserveLamports;
    if (lamportsToSend <= 0) {
      results.push({
        publicKey: sourceWallet.publicKey.toBase58(),
        status: "skipped",
        remainingBalanceSol: balanceLamports / LAMPORTS_PER_SOL,
        error:
          reclaimMode === "main-sponsored"
            ? "Insufficient balance after fee"
            : "Insufficient balance after fee and rent reserve",
      });
      continue;
    }
    try {
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sourceWallet.publicKey,
          toPubkey: mainPublicKey,
          lamports: lamportsToSend,
        })
      );
      transaction.feePayer =
        reclaimMode === "main-sponsored"
          ? mainPublicKey
          : sourceWallet.publicKey;
      const returnTrackId = userId
        ? await appTransactionService.create({
            userId,
            type: "TRANSFER_RETURN",
            source: "LAUNCH",
            tokenPublicKey,
            walletPublicKey: sourceWallet.publicKey.toBase58(),
            fromAddress: sourceWallet.publicKey.toBase58(),
            toAddress: mainPublicKey.toBase58(),
            solAmount: lamportsToSend / 1_000_000_000,
            referenceId: launchId,
          }).then((r) => r.id).catch(() => null)
        : null;
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        reclaimMode === "main-sponsored"
          ? [mainWalletKeypair, sourceWallet]
          : [sourceWallet],
        { commitment: "confirmed" }
      );
      if (returnTrackId) await appTransactionService.confirm(returnTrackId, { signature }).catch(() => {});
      await testRunLogService.appendServerEvent({
        eventType: "wallet_transaction",
        source: "launch.service",
        action: "launch.returnExcessSolToMain",
        launchId,
        wallets: [sourceWallet.publicKey.toBase58(), mainWalletPublicKey],
        signature,
        status: "submitted",
        expectedValue: {
          lamportsToSend,
          reclaimMode,
        },
        actualValue: {
          publicKey: sourceWallet.publicKey.toBase58(),
          amountSol: lamportsToSol(BigInt(lamportsToSend)),
        },
      });
      totalReturnedLamports += BigInt(lamportsToSend);
      results.push({
        publicKey: sourceWallet.publicKey.toBase58(),
        status: "returned",
        signature,
        amountSol: lamportsToSol(BigInt(lamportsToSend)),
        remainingBalanceSol:
          reclaimMode === "main-sponsored"
            ? 0
            : (TRANSFER_FEE_BUFFER_LAMPORTS + rentExemptReserveLamports) /
              LAMPORTS_PER_SOL,
      });
    } catch (error) {
      const remainingBalanceLamports = await connection.getBalance(
        sourceWallet.publicKey
      );
      results.push({
        publicKey: sourceWallet.publicKey.toBase58(),
        status: "failed",
        remainingBalanceSol: remainingBalanceLamports / LAMPORTS_PER_SOL,
        error: getErrorMessage(error) || "Return failed",
      });
    }
  }

  return {
    attempted: uniqueSourceWallets.length,
    returned: results.filter((result) => result.status === "returned").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    totalReturnedSol: lamportsToSol(totalReturnedLamports),
    results,
    durationMs: Date.now() - startedAt,
  };
}

function buildLaunchSuccessResult(params: {
  tokenPublicKey: string;
  devWalletPublicKey: string;
  mainWalletPublicKey: string;
  bundlerWalletPublicKeys: string[];
  recovery: LaunchRecoveryData;
  jitoTipAmountSol: number;
  solReturn: {
    attempted: number;
    returned: number;
    failed: number;
    skipped: number;
    totalReturnedSol: number;
    results: SolReturnResult[];
  } | null;
}): Prisma.InputJsonObject {
  const {
    tokenPublicKey,
    devWalletPublicKey,
    mainWalletPublicKey,
    bundlerWalletPublicKeys,
    recovery,
    jitoTipAmountSol,
    solReturn,
  } = params;

  return {
    tokenPublicKey,
    devWalletPublicKey,
    mainWalletPublicKey,
    bundlerWallets: bundlerWalletPublicKeys,
    jitoTipAmountSol,
    ...(solReturn ? { solReturn } : {}),
    recovery,
  };
}

async function finalizeLaunch(
  launchId: string,
  userId: string,
  tokenPublicKey: string,
  devWalletPublicKey: string,
  mainWalletPublicKey: string,
  bundlerWalletKeypairs: Keypair[],
  recovery: LaunchRecoveryData,
  usageFeeTotalSol: number,
  jitoTipAmountSol: number,
  solReturn: {
    attempted: number;
    returned: number;
    failed: number;
    skipped: number;
    totalReturnedSol: number;
    results: SolReturnResult[];
  } | null,
  durationMs?: number
) {
  const finalStatus = (await isCancelRequested(launchId))
    ? "CANCELED"
    : "SUCCEEDED";

  if (finalStatus === "SUCCEEDED" && usageFeeTotalSol > 0) {
    try {
      const usageFeeResult = await usageFeeService.collectFromMainWallet({
        userId,
        totalFeeSol: usageFeeTotalSol,
        reason: "launch.success",
        txSource: "LAUNCH",
        referenceId: launchId,
        tokenPublicKey,
      });
      await appendLog(launchId, "INFO", "Usage fee collected", "fees", {
        skipped: usageFeeResult.skipped,
        amountSol: usageFeeResult.amountSol,
        amountLamports: usageFeeResult.amountLamports,
        signature: usageFeeResult.signature,
        fromPublicKey: usageFeeResult.fromPublicKey,
        toPublicKey: usageFeeResult.toPublicKey,
        reason: usageFeeResult.reason,
      });
    } catch (error) {
      const message = getErrorMessage(error) || "Failed to collect usage fee";
      logger.warn("Launch usage fee collection on success failed", {
        launchId,
        userId,
        message,
      });
      await appendLog(
        launchId,
        "WARN",
        "Usage fee collection failed after successful launch",
        "fees",
        {
          amountSol: usageFeeTotalSol,
          errorMessage: message,
          reason: "launch.success",
        }
      );
    }
  }

  await updateLaunchRecord(launchId, {
    status: finalStatus,
    progress: 100,
    currentStep: "complete",
    errorMessage: null,
    completedAt: new Date(),
    tokenPublicKey,
    result: buildLaunchSuccessResult({
      tokenPublicKey,
      devWalletPublicKey,
      mainWalletPublicKey,
      bundlerWalletPublicKeys: bundlerWalletKeypairs.map((wallet) =>
        wallet.publicKey.toBase58()
      ),
      recovery,
      jitoTipAmountSol,
      solReturn,
    }),
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

  if (finalStatus === "SUCCEEDED") {
    invalidateStatsCache(tokenPublicKey);
  }
}

async function finalizeLaunchFailure(params: {
  launchId: string;
  error: unknown;
  launchStartedAt: number;
  persistedTokenPublicKey: string | null;
  reservedVanityId: string | null;
  vanityConsumed: boolean;
  recoveryData: LaunchRecoveryData | null;
  mainWalletKeypair: Keypair | null;
  managedLaunchWallets: Keypair[];
  fundedLaunchWallets: LaunchWalletFundingSnapshot[];
  userId?: string;
}) {
  const {
    launchId,
    error,
    launchStartedAt,
    persistedTokenPublicKey,
    reservedVanityId,
    vanityConsumed,
    recoveryData,
    mainWalletKeypair,
    managedLaunchWallets,
    fundedLaunchWallets,
    userId,
  } = params;
  if (persistedTokenPublicKey) {
    try {
      await failToken(persistedTokenPublicKey);
    } catch (tokenStatusError) {
      logger.warn("Failed to mark token as failed after launch error", {
        launchId,
        tokenPublicKey: persistedTokenPublicKey,
        message: getErrorMessage(tokenStatusError),
      });
    }
  }

  if (reservedVanityId && !vanityConsumed) {
    try {
      await releaseReservedVanityMint(reservedVanityId);
    } catch (releaseError) {
      logger.warn("Failed to release reserved vanity mint", {
        launchId,
        vanityMintId: reservedVanityId,
        message: getErrorMessage(releaseError),
      });
    }
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

  let failureRecoveryResult: Prisma.InputJsonObject | null = null;
  if (recoveryData && mainWalletKeypair) {
    try {
      await setStep(launchId, 96, "reclaim", "Reclaiming remaining SOL");
      const reclaimResult = await reclaimManagedLaunchWallets(
        launchId,
        mainWalletKeypair,
        managedLaunchWallets,
        userId,
        fundedLaunchWallets
      );
      const reclaimSummary = summarizeFailureRecoveryAttempt(
        reclaimResult.results
      );
      failureRecoveryResult = {
        ...reclaimSummary,
        attemptedWalletCount: reclaimResult.attempted,
        durationMs: reclaimResult.durationMs,
        results: reclaimResult.results,
      };

      if (!reclaimSummary.attempted) {
        await appendLog(
          launchId,
          "INFO",
          "No remaining SOL to reclaim",
          "reclaim"
        );
      } else if (reclaimSummary.manualActionRequired) {
        await appendLog(
          launchId,
          "ERROR",
          reclaimSummary.failureMessage ??
            "Automatic reclaim could not return all wallet SOL.",
          "reclaim",
          {
            recoveredWalletCount: reclaimSummary.recoveredWalletCount,
            failedWalletCount: reclaimSummary.failedWalletCount,
            skippedWalletCount: reclaimSummary.skippedWalletCount,
            totalReturnedSol: reclaimSummary.totalReturnedSol,
            results: reclaimResult.results,
            durationMs: reclaimResult.durationMs,
          }
        );
      } else {
        await appendLog(
          launchId,
          "INFO",
          "Funds reclaimed to main wallet",
          "reclaim",
          {
            recoveredWalletCount: reclaimSummary.recoveredWalletCount,
            skippedWalletCount: reclaimSummary.skippedWalletCount,
            totalReturnedSol: reclaimSummary.totalReturnedSol,
            results: reclaimResult.results,
            durationMs: reclaimResult.durationMs,
          }
        );
      }
    } catch (reclaimError) {
      const reclaimErrorMessage =
        getErrorMessage(reclaimError) || "Automatic reclaim failed";
      failureRecoveryResult = {
        attempted: true,
        manualActionRequired: true,
        recoveredWalletCount: 0,
        failedWalletCount: managedLaunchWallets.length,
        skippedWalletCount: 0,
        totalReturnedSol: 0,
        failureMessage: "Automatic reclaim could not return all wallet SOL.",
        errorMessage: reclaimErrorMessage,
      };
      logger.error("Automatic launch reclaim failed", {
        launchId,
        errorMessage: reclaimErrorMessage,
      });
      await appendLog(
        launchId,
        "ERROR",
        "Automatic reclaim could not return all wallet SOL.",
        "reclaim",
        {
          errorMessage: reclaimErrorMessage,
        }
      );
    }
  }

  await updateLaunchRecord(launchId, {
    status: "FAILED",
    progress: 100,
    currentStep: failureRecoveryResult ? "reclaim" : "error",
    errorMessage: clientMessage,
    completedAt: new Date(),
    result: {
      ...(recoveryData ? { recovery: recoveryData } : {}),
      ...(failureRecoveryResult
        ? { failureRecovery: failureRecoveryResult }
        : {}),
    },
  });
  const logData: Prisma.InputJsonObject = {
    durationMs,
    errorName,
    ...(errorMessage ? { errorMessage } : {}),
    ...(reservedVanityId
      ? {
          vanityMint: {
            id: reservedVanityId,
            consumed: vanityConsumed,
          },
        }
      : {}),
  };
  await appendLog(launchId, "ERROR", clientMessage, "error", logData);
}

async function repairSuccessfulLaunchAfterError(params: {
  launchId: string;
  tokenPublicKey: string;
  recovery: LaunchRecoveryData;
  jitoTipAmountSol: number;
  error: unknown;
}) {
  const { launchId, tokenPublicKey, recovery, jitoTipAmountSol, error } =
    params;
  const errorMessage = getErrorMessage(error);
  const finalStatus = (await isCancelRequested(launchId))
    ? "CANCELED"
    : "SUCCEEDED";

  logger.warn("Repairing launch state after post-confirm persistence failure", {
    launchId,
    tokenPublicKey,
    finalStatus,
    errorMessage,
  });

  try {
    await activateToken(tokenPublicKey);
  } catch (activateError) {
    logger.warn("Failed to reactivate token during launch repair", {
      launchId,
      tokenPublicKey,
      message: getErrorMessage(activateError),
    });
  }

  await updateLaunchRecord(launchId, {
    status: finalStatus,
    progress: 100,
    currentStep: "complete",
    errorMessage: null,
    completedAt: new Date(),
    tokenPublicKey,
    result: buildLaunchSuccessResult({
      tokenPublicKey,
      devWalletPublicKey: recovery.devWalletPublicKey,
      mainWalletPublicKey: recovery.mainWalletPublicKey,
      bundlerWalletPublicKeys: recovery.bundlerWallets,
      recovery,
      jitoTipAmountSol,
      solReturn: null,
    }),
  });
}

async function reclaimManagedLaunchWallets(
  launchId: string,
  mainWalletKeypair: Keypair,
  sourceWallets: Keypair[],
  userId?: string,
  inMemoryFundedWallets: LaunchWalletFundingSnapshot[] = []
) {
  const startedAt = Date.now();
  const connection = getSolanaConnection();
  const mainPublicKey = mainWalletKeypair.publicKey;
  const uniqueSourceWallets = sourceWallets.filter(
    (wallet, index, all) =>
      !wallet.publicKey.equals(mainPublicKey) &&
      all.findIndex((item) => item.publicKey.equals(wallet.publicKey)) === index
  );

  if (uniqueSourceWallets.length === 0) {
    return {
      attempted: 0,
      returned: 0,
      failed: 0,
      skipped: 0,
      totalReturnedSol: 0,
      results: [] as SolReturnResult[],
      durationMs: Date.now() - startedAt,
    };
  }

  const recoveryWalletRows = await prisma.launchRecoveryWallet.findMany({
    where: {
      launchId,
      walletPublicKey: {
        in: uniqueSourceWallets.map((wallet) => wallet.publicKey.toBase58()),
      },
    },
    select: {
      walletPublicKey: true,
      fundedLamports: true,
    },
  });
  const fundedLamportsByPublicKey = new Map(
    inMemoryFundedWallets.map((wallet) => [wallet.publicKey, wallet.fundedLamports])
  );
  for (const recoveryWallet of recoveryWalletRows) {
    fundedLamportsByPublicKey.set(
      recoveryWallet.walletPublicKey,
      BigInt(recoveryWallet.fundedLamports.toString())
    );
  }

  const results: SolReturnResult[] = [];
  let totalReturnedLamports = BigInt(0);

  for (const sourceWallet of uniqueSourceWallets) {
    const attemptedAt = new Date();
    const walletPublicKey = sourceWallet.publicKey.toBase58();
    const balanceLamports = await connection.getBalance(sourceWallet.publicKey);
    const fundedLamports =
      fundedLamportsByPublicKey.get(walletPublicKey) ?? BigInt(0);
    const lamportsToSend = computeFailedLaunchDrainLamports(
      balanceLamports,
      fundedLamports
    );
    if (lamportsToSend <= 0) {
      const reclaimError =
        balanceLamports <= 0
          ? "Zero balance"
          : fundedLamports <= BigInt(0)
            ? "No launch-funded balance recorded"
            : "No launch-funded balance remaining";
      await prisma.launchRecoveryWallet.updateMany({
        where: {
          launchId,
          walletPublicKey,
        },
        data: {
          reclaimStatus: "SKIPPED",
          reclaimError,
          reclaimTxSignature: null,
          lastAttemptAt: attemptedAt,
        },
      });
      results.push({
        publicKey: walletPublicKey,
        status: "skipped",
        remainingBalanceSol: balanceLamports / LAMPORTS_PER_SOL,
        error: reclaimError,
      });
      continue;
    }

    try {
      const transaction = new Transaction();
      transaction.feePayer = mainPublicKey;
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: sourceWallet.publicKey,
          toPubkey: mainPublicKey,
          lamports: lamportsToSend,
        })
      );
      const reclaimTrackId = userId
        ? await appTransactionService.create({
            userId,
            type: "TRANSFER_RECLAIM",
            source: "LAUNCH",
            walletPublicKey,
            fromAddress: walletPublicKey,
            toAddress: mainPublicKey.toBase58(),
            solAmount: lamportsToSend / 1_000_000_000,
            referenceId: launchId,
          }).then((r) => r.id).catch(() => null)
        : null;
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [mainWalletKeypair, sourceWallet],
        { commitment: "confirmed" }
      );
      if (reclaimTrackId) await appTransactionService.confirm(reclaimTrackId, { signature }).catch(() => {});
      await prisma.launchRecoveryWallet.updateMany({
        where: {
          launchId,
          walletPublicKey,
        },
        data: {
          reclaimStatus: "RETURNED",
          reclaimError: null,
          reclaimTxSignature: signature,
          lastAttemptAt: attemptedAt,
          reclaimedAt: new Date(),
        },
      });
      await testRunLogService.appendServerEvent({
        eventType: "funds_return",
        source: "launch.service",
        action: "launch.failureReclaim",
        launchId,
        wallets: [walletPublicKey, mainPublicKey.toBase58()],
        signature,
        status: "submitted",
        actualValue: {
          amountSol: lamportsToSol(BigInt(lamportsToSend)),
          walletPublicKey,
        },
      });
      totalReturnedLamports += BigInt(lamportsToSend);
      results.push({
        publicKey: walletPublicKey,
        status: "returned",
        signature,
        amountSol: lamportsToSol(BigInt(lamportsToSend)),
        remainingBalanceSol:
          (balanceLamports - lamportsToSend) / LAMPORTS_PER_SOL,
      });
    } catch (reclaimError) {
      const errorMessage =
        getErrorMessage(reclaimError) || "Automatic reclaim failed";
      const remainingBalanceLamports = await connection.getBalance(
        sourceWallet.publicKey
      );
      await prisma.launchRecoveryWallet.updateMany({
        where: {
          launchId,
          walletPublicKey,
        },
        data: {
          reclaimStatus: "FAILED",
          reclaimError: errorMessage,
          reclaimTxSignature: null,
          lastAttemptAt: attemptedAt,
        },
      });
      results.push({
        publicKey: walletPublicKey,
        status: "failed",
        remainingBalanceSol: remainingBalanceLamports / LAMPORTS_PER_SOL,
        error: errorMessage,
      });
    }
  }

  return {
    attempted: uniqueSourceWallets.length,
    returned: results.filter((result) => result.status === "returned").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    totalReturnedSol: lamportsToSol(totalReturnedLamports),
    results,
    durationMs: Date.now() - startedAt,
  };
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

  const recoveryWallets = await prisma.launchRecoveryWallet.findMany({
    where: { launchId },
    orderBy: { createdAt: "asc" },
    select: {
      walletPublicKey: true,
      walletType: true,
      isManaged: true,
      reclaimStatus: true,
      reclaimTxSignature: true,
      reclaimError: true,
      reclaimedAt: true,
      lastAttemptAt: true,
      role: true,
    },
  });
  const managedWalletPublicKeys = recoveryWallets
    .filter((wallet) => wallet.isManaged)
    .map((wallet) => wallet.walletPublicKey);
  const excludedDevWalletPublicKey =
    recoveryWallets.find((wallet) => wallet.role === "DEV" && !wallet.isManaged)
      ?.walletPublicKey ?? null;

  return {
    launch: resolvedLaunch,
    source: "launch_snapshot" as const,
    mainWalletPublicKey,
    walletPublicKeys: managedWalletPublicKeys,
    recoveryWallets,
    excludedDevWalletPublicKey,
  };
}

async function resolveFailedLaunchByToken(
  tokenPublicKey: string,
  userId: string
) {
  const launch = await prisma.launch.findFirst({
    where: {
      userId,
      tokenPublicKey,
      status: { in: ["FAILED", "CANCELED", "SUCCEEDED"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!launch) {
    throw new AppError("No launch found for token", 404);
  }
  return launch.id;
}

export type FailedLaunchRow = {
  launchId: string;
  launchStatus: string;
  tokenPublicKey: string | null;
  tokenName: string;
  tokenSymbol: string;
  errorMessage: string | null;
  createdAt: Date;
};

export type UserLaunchRow = {
  id: string;
  status: string;
  retriedFromLaunchId: string | null;
  hasRetryAttempts: boolean;
  tokenPublicKey: string | null;
  tokenName: string;
  tokenSymbol: string;
  imageUrl: string | null;
  websiteUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  errorMessage: string | null;
  createdAt: Date;
  input: Record<string, unknown>;
};

export const launchService = {
  async previewCosts(input: LaunchPreviewCostsInput, user: RequestUser) {
    return await calculateLaunchCostPreview(input, user);
  },

  async getUserLaunches(userId: string): Promise<UserLaunchRow[]> {
    const launches = await prisma.launch.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        retriedFromLaunchId: true,
        input: true,
        tokenPublicKey: true,
        errorMessage: true,
        createdAt: true,
        retryAttempts: {
          select: { id: true },
          take: 1,
        },
        token: {
          select: {
            name: true,
            symbol: true,
            imageUrl: true,
            websiteUrl: true,
            twitterUrl: true,
            telegramUrl: true,
          },
        },
      },
    });

    return launches.map((launch) => {
      const input = launch.input as Record<string, unknown> | null;
      return {
        id: launch.id,
        status: launch.status,
        retriedFromLaunchId: launch.retriedFromLaunchId,
        hasRetryAttempts: launch.retryAttempts.length > 0,
        tokenPublicKey: launch.tokenPublicKey,
        tokenName:
          launch.token?.name ??
          (typeof input?.tokenName === "string" ? input.tokenName : "Unknown"),
        tokenSymbol:
          launch.token?.symbol ??
          (typeof input?.tokenSymbol === "string" ? input.tokenSymbol : "—"),
        imageUrl: launch.token?.imageUrl ?? null,
        websiteUrl:
          launch.token?.websiteUrl ??
          (typeof input?.website === "string" ? input.website : null),
        twitterUrl:
          launch.token?.twitterUrl ??
          (typeof input?.twitter === "string" ? input.twitter : null),
        telegramUrl:
          launch.token?.telegramUrl ??
          (typeof input?.telegram === "string" ? input.telegram : null),
        errorMessage: launch.errorMessage,
        createdAt: launch.createdAt,
        input: (input ?? {}) as Record<string, unknown>,
      };
    });
  },

  async getFailedLaunches(userId: string): Promise<FailedLaunchRow[]> {
    logger.info("getFailedLaunches called", { userId });
    try {
      const launches = await prisma.launch.findMany({
        where: {
          userId,
          status: { in: ["FAILED", "CANCELED"] },
          recoveryWallets: { some: {} },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          tokenPublicKey: true,
          errorMessage: true,
          createdAt: true,
          input: true,
        },
      });
      logger.info("getFailedLaunches result", { count: launches.length });
      return launches.map((launch) => {
        const input = launch.input as Record<string, unknown> | null;
        return {
          launchId: launch.id,
          launchStatus: launch.status,
          tokenPublicKey: launch.tokenPublicKey,
          tokenName:
            typeof input?.tokenName === "string"
              ? input.tokenName
              : "Failed Launch",
          tokenSymbol:
            typeof input?.tokenSymbol === "string" ? input.tokenSymbol : "—",
          errorMessage: launch.errorMessage,
          createdAt: launch.createdAt,
        };
      });
    } catch (error) {
      logger.error("getFailedLaunches error", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  },

  async startLaunch(input: LaunchTokenInput, user: RequestUser) {
    const idempotencyKey = [
      "launch-start",
      user.id,
      input.tokenName.trim().toLowerCase(),
      normalizeSymbol(input.tokenSymbol),
    ].join(":");
    const actionKey = `launch:start:${user.id}`;

    return await withActionLock(actionKey, async () => {
      return await withIdempotency({
        key: idempotencyKey,
        ttlMs: 15_000,
        execute: async () => {
          const existing = await prisma.launch.findFirst({
            where: {
              userId: user.id,
              status: { in: ["PENDING", "RUNNING"] },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (existing) {
            return { launchId: existing.id };
          }

          const normalizedInput =
            await normalizeLaunchInputMediaForStorage(input);
          await ensureLaunchFundingAvailable(normalizedInput, user);
          const launchRealtimeAccess = grpcAccessService.getFeatureAccess(
            user,
            "launch-fast-confirmation"
          );
          const queuedInput: StoredLaunchInput = {
            ...normalizedInput,
            entitlementSnapshot: {
              plan: user.plan,
              launchRealtimeEnabled: launchRealtimeAccess.allowed,
              platformFeeWaived: grpcAccessService.isPlatformFeeWaived(user),
            },
          };
          const launch = await prisma.launch.create({
            data: {
              userId: user.id,
              status: "PENDING",
              input: queuedInput,
            },
          });

          appendLog(launch.id, "STEP", "Launch queued", "queue");
          void this.runLaunchJob(launch.id);

          return { launchId: launch.id };
        },
      });
    });
  },

  async retryLaunch(launchId: string, user: RequestUser) {
    const actionKey = `launch:retry:${user.id}:${launchId}`;
    return await withActionLock(actionKey, async () => {
      const existingActive = await prisma.launch.findFirst({
        where: {
          userId: user.id,
          status: { in: ["PENDING", "RUNNING"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (existingActive) {
        return { launchId: existingActive.id };
      }

      const sourceLaunch = await prisma.launch.findFirst({
        where: {
          id: launchId,
          userId: user.id,
          status: { in: ["FAILED", "CANCELED"] },
        },
        select: {
          id: true,
          userId: true,
          input: true,
          tokenPublicKey: true,
          status: true,
          token: {
            select: {
              status: true,
            },
          },
        },
      });
      if (!sourceLaunch) {
        throw new AppError("Failed launch not found", 404);
      }

      if (sourceLaunch.token?.status === "ACTIVE") {
        throw new AppError(
          "Launch cannot be retried after token activation",
          400
        );
      }

      const parsedInput = launchTokenSchema.safeParse(sourceLaunch.input);
      if (!parsedInput.success) {
        throw new AppError(
          "Launch retry is unavailable because original input is no longer valid",
          400
        );
      }
      const retryInput: LaunchTokenInput = parsedInput.data;
      await ensureLaunchFundingAvailable(retryInput, user);
      const retryRealtimeAccess = grpcAccessService.getFeatureAccess(
        user,
        "launch-fast-confirmation"
      );

      const retryLaunch = await prisma.launch.create({
        data: {
          userId: sourceLaunch.userId,
          status: "PENDING",
          input: {
            ...retryInput,
            entitlementSnapshot: {
              plan: user.plan,
              launchRealtimeEnabled: retryRealtimeAccess.allowed,
              platformFeeWaived: grpcAccessService.isPlatformFeeWaived(user),
            },
          } satisfies StoredLaunchInput,
          retriedFromLaunchId: sourceLaunch.id,
        },
      });

      await appendLog(retryLaunch.id, "STEP", "Launch retry queued", "queue", {
        retriedFromLaunchId: sourceLaunch.id,
        sourceLaunchStatus: sourceLaunch.status,
        feeRecollected: false,
      });
      void this.runLaunchJob(retryLaunch.id);

      return { launchId: retryLaunch.id, retriedFromLaunchId: sourceLaunch.id };
    });
  },

  async getLaunchStatus(launchId: string, userId: string) {
    const launch = await prisma.launch.findFirst({
      where: { id: launchId, userId },
    });

    if (!launch) {
      throw new AppError("Launch not found", 404);
    }

    const logsDesc = await prisma.launchLog.findMany({
      where: { launchId: launch.id },
      orderBy: { createdAt: "desc" },
      take: LAUNCH_LOG_WINDOW,
    });

    return await markLaunchStaleIfNeeded({
      ...launch,
      logs: logsDesc.reverse(),
    });
  },

  async getActiveLaunch(userId: string) {
    const launch = await prisma.launch.findFirst({
      where: {
        userId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!launch) {
      return null;
    }

    const logsDesc = await prisma.launchLog.findMany({
      where: { launchId: launch.id },
      orderBy: { createdAt: "desc" },
      take: LAUNCH_LOG_WINDOW,
    });

    return await markLaunchStaleIfNeeded({
      ...launch,
      logs: logsDesc.reverse(),
    });
  },
  async getRecoveryWallets(launchId: string, userId: string) {
    const {
      launch,
      source,
      mainWalletPublicKey,
      walletPublicKeys,
      recoveryWallets,
      excludedDevWalletPublicKey,
    } = await loadLaunchRecoveryInfo(launchId, userId);

    if (
      launch.status !== "FAILED" &&
      launch.status !== "CANCELED" &&
      launch.status !== "SUCCEEDED"
    ) {
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
    const recoveryWalletMap = new Map(
      recoveryWallets.map((wallet) => [wallet.walletPublicKey, wallet])
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
          reclaimStatus:
            recoveryWalletMap.get(wallet.publicKey)?.reclaimStatus ??
            "ELIGIBLE",
          reclaimTxSignature:
            recoveryWalletMap.get(wallet.publicKey)?.reclaimTxSignature ?? null,
          reclaimError:
            recoveryWalletMap.get(wallet.publicKey)?.reclaimError ?? null,
          reclaimedAt:
            recoveryWalletMap.get(wallet.publicKey)?.reclaimedAt ?? null,
          lastAttemptAt:
            recoveryWalletMap.get(wallet.publicKey)?.lastAttemptAt ?? null,
        };
      })
    );

    if (balances.length > 0) {
      await Promise.all(
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
  async getRecoveryWalletsByToken(tokenPublicKey: string, userId: string) {
    const launchId = await resolveFailedLaunchByToken(tokenPublicKey, userId);
    return await this.getRecoveryWallets(launchId, userId);
  },
  async recoverSol(
    launchId: string,
    userId: string,
    walletPublicKeys?: string[]
  ) {
    const {
      launch,
      mainWalletPublicKey,
      recoveryWallets: recoveryWalletRows,
      walletPublicKeys: recoveryWallets,
    } = await loadLaunchRecoveryInfo(launchId, userId);

    if (
      launch.status !== "FAILED" &&
      launch.status !== "CANCELED" &&
      launch.status !== "SUCCEEDED"
    ) {
      throw new AppError("Launch is not eligible for recovery", 400);
    }

    const targetWallets = walletPublicKeys?.length
      ? walletPublicKeys.filter((key) => recoveryWallets.includes(key))
      : recoveryWallets;

    if (targetWallets.length === 0) {
      return {
        mainWalletPublicKey,
        results: [],
      };
    }

    const mainWalletRecord = await prisma.wallet.findUnique({
      where: { publicKey: mainWalletPublicKey },
      select: { publicKey: true, privateKey: true },
    });
    if (!mainWalletRecord) {
      throw new AppError("Main wallet not accessible", 500);
    }
    const mainKeypair = Keypair.fromSecretKey(
      bs58.decode(mainWalletRecord.privateKey)
    );
    const wallets = await prisma.wallet.findMany({
      where: { userId, publicKey: { in: targetWallets } },
      select: { publicKey: true, privateKey: true },
    });
    const walletMap = new Map(
      wallets.map((wallet) => [wallet.publicKey, wallet])
    );
    const selectedWallets = targetWallets
      .map((publicKey) => walletMap.get(publicKey))
      .filter((wallet): wallet is (typeof wallets)[number] => Boolean(wallet));
    const recoveryRowMap = new Map(
      recoveryWalletRows.map((row) => [row.walletPublicKey, row])
    );

    const connection = getSolanaConnection();
    const mainPublicKey = new PublicKey(mainWalletPublicKey);
    const results: {
      publicKey: string;
      status: "returned" | "skipped" | "failed";
      signature?: string;
      amountSol?: number;
      error?: string;
    }[] = [];

    const RECOVERY_BATCH_SIZE = 5;
    for (let i = 0; i < selectedWallets.length; i += RECOVERY_BATCH_SIZE) {
      const batch = selectedWallets.slice(i, i + RECOVERY_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (wallet) => {
          const recoveryRow = recoveryRowMap.get(wallet.publicKey);
          if (recoveryRow?.reclaimStatus === "RETURNED") {
            return {
              publicKey: wallet.publicKey,
              status: "skipped" as const,
              error: "Already returned",
            };
          }

          const attemptedAt = new Date();
          const walletPublicKey = new PublicKey(wallet.publicKey);
          const balanceLamports = await connection.getBalance(walletPublicKey);
          if (balanceLamports <= 0) {
            await prisma.launchRecoveryWallet.updateMany({
              where: { launchId, walletPublicKey: wallet.publicKey },
              data: {
                reclaimStatus: "SKIPPED",
                reclaimError: "Zero balance",
                reclaimTxSignature: null,
                lastAttemptAt: attemptedAt,
              },
            });
            return {
              publicKey: wallet.publicKey,
              status: "skipped" as const,
              error: "Zero balance",
            };
          }

          try {
            const sender = Keypair.fromSecretKey(
              bs58.decode(wallet.privateKey)
            );
            const transaction = new Transaction();
            transaction.feePayer = mainPublicKey;
            transaction.add(
              SystemProgram.transfer({
                fromPubkey: sender.publicKey,
                toPubkey: mainPublicKey,
                lamports: balanceLamports,
              })
            );
            const recoverTrackId = await appTransactionService
              .create({
                userId,
                type: "TRANSFER_RECLAIM",
                source: "LAUNCH",
                walletPublicKey: wallet.publicKey,
                fromAddress: wallet.publicKey,
                toAddress: mainPublicKey.toBase58(),
                solAmount: balanceLamports / 1_000_000_000,
                referenceId: launchId,
              })
              .then((r) => r.id)
              .catch(() => null);
            const signature = await sendAndConfirmTransaction(
              connection,
              transaction,
              [mainKeypair, sender],
              { commitment: "confirmed" }
            );
            if (recoverTrackId) await appTransactionService.confirm(recoverTrackId, { signature }).catch(() => {});
            await testRunLogService.appendServerEvent({
              eventType: "wallet_transaction",
              source: "launch.service",
              action: "launch.recoverSol",
              launchId,
              userId,
              wallets: [wallet.publicKey, mainPublicKey.toBase58()],
              signature,
              status: "submitted",
              actualValue: {
                amountSol: lamportsToSol(BigInt(balanceLamports)),
                walletPublicKey: wallet.publicKey,
              },
            });
            await prisma.launchRecoveryWallet.updateMany({
              where: { launchId, walletPublicKey: wallet.publicKey },
              data: {
                reclaimStatus: "RETURNED",
                reclaimError: null,
                reclaimTxSignature: signature,
                lastAttemptAt: attemptedAt,
                reclaimedAt: new Date(),
              },
            });
            return {
              publicKey: wallet.publicKey,
              status: "returned" as const,
              signature,
              amountSol: lamportsToSol(BigInt(balanceLamports)),
            };
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Return failed";
            logger.error("Recovery transfer failed", {
              launchId,
              walletPublicKey: wallet.publicKey,
              error: errorMessage,
            });
            await prisma.launchRecoveryWallet.updateMany({
              where: { launchId, walletPublicKey: wallet.publicKey },
              data: {
                reclaimStatus: "FAILED",
                reclaimError: errorMessage,
                reclaimTxSignature: null,
                lastAttemptAt: attemptedAt,
              },
            });
            return {
              publicKey: wallet.publicKey,
              status: "failed" as const,
              error: errorMessage,
            };
          }
        })
      );
      results.push(...batchResults);
    }

    const returnedWalletPublicKeys = results
      .filter((result) => result.status === "returned")
      .map((result) => result.publicKey);
    if (launch.tokenPublicKey && returnedWalletPublicKeys.length > 0) {
      const refreshWalletPublicKeys = Array.from(
        new Set([mainWalletPublicKey, ...returnedWalletPublicKeys])
      );
      try {
        await walletService.refreshWalletBalances(
          launch.tokenPublicKey,
          userId,
          refreshWalletPublicKeys,
          true
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("Launch recovery post-tx refresh failed", {
          launchId,
          tokenPublicKey: launch.tokenPublicKey,
          message,
        });
      }
    }

    return {
      mainWalletPublicKey,
      results,
    };
  },
  async recoverSolByToken(
    tokenPublicKey: string,
    userId: string,
    walletPublicKeys?: string[]
  ) {
    const launchId = await resolveFailedLaunchByToken(tokenPublicKey, userId);
    return await this.recoverSol(launchId, userId, walletPublicKeys);
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
      const updated = await updateLaunchRecord(launchId, {
        status: "CANCELED",
        cancelRequestedAt: new Date(),
        completedAt: new Date(),
      });
      await appendLog(
        launchId,
        "WARN",
        "Launch canceled before start",
        "cancel"
      );
      return updated;
    }

    const updated = await updateLaunchRecord(launchId, {
      cancelRequestedAt: new Date(),
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

    await updateLaunchRecord(launchId, {
      status: "RUNNING",
      startedAt: new Date(),
      progress: 2,
    });

    const launchStartedAt = Date.now();
    const input = launch.input as StoredLaunchInput;
    const requestPlan = input.entitlementSnapshot?.plan ?? UserPlan.FREE;
    const {
      createFeeBufferLamports: CREATE_FEE_BUFFER_LAMPORTS,
      minCreatorBalanceLamports: MIN_CREATOR_BALANCE_LAMPORTS,
      slippageBasisPoints: SLIPPAGE_BASIS_POINTS,
    } = getLaunchConfig();
    let reservedVanityId: string | null = null;
    let vanityConsumed = false;
    let recoveryData: LaunchRecoveryData | null = null;
    let persistedTokenPublicKey: string | null = null;
    let mainWalletKeypair: Keypair | null = null;
    let managedLaunchWallets: Keypair[] = [];
    let fundedLaunchWallets: LaunchWalletFundingSnapshot[] = [];
    let launchReadyForSuccessRepair = false;

    try {
      const usageFees = applyLaunchFeePolicy(input, { plan: requestPlan });
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
        usageFeeTotalSol: usageFees.totalFeeSol,
        usageFeeGeneratedWallets: usageFees.generatedWalletCount,
        usageFeeGeneratedWalletFeeSol: usageFees.generatedWalletFeeSol,
        usageFeeVanityFeeSol: usageFees.vanityMintFeeSol,
        usageFeeBundleBuyFeeSol: usageFees.bundleBuyFeeSol,
        usageFeeDescriptionAttributionRemovalFeeSol:
          usageFees.descriptionAttributionRemovalFeeSol,
        usageFeeNonSystemDevWalletFeeSol: usageFees.nonSystemDevWalletFeeSol,
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
      mainWalletKeypair = keypairFromPrivateKey(user.mainWallet.privateKey);
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
      const bundlerBuyAllocation = input.bundleBuyEnabled
        ? buildBundlerBuyTargets(
            bundlerWalletKeypairs,
            bundlerBuyAmountSol,
            bundlerBuyVariancePercent,
            launchId
          )
        : {
            amountLamportsByWallet: [] as bigint[],
            lowerBoundLamports: BigInt(0),
            upperBoundLamports: BigInt(0),
            usedFallback: false,
            targets: [] as BundlerBuyTarget[],
          };
      await appendLog(launchId, "INFO", "Wallets prepared", "wallets", {
        mainWalletPublicKey: user.mainWallet.publicKey,
        devWalletPublicKey,
        usesMainWalletAsDev: devWalletPublicKey === user.mainWallet.publicKey,
        devWalletOption: input.devWalletOption,
        bundlerWallets: bundlerWalletKeypairs.length,
        distributionWallets: distributionWallets.length,
        distributionWalletMultiplier,
        bundleBuyEnabled: input.bundleBuyEnabled,
        bundleBuyAllocationUsedFallback: bundlerBuyAllocation.usedFallback,
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
      await persistLaunchRecoveryWallets(
        launchId,
        input,
        user.mainWallet.publicKey,
        devWalletPublicKey,
        bundlerWalletKeypairs,
        distributionWallets
      );
      managedLaunchWallets = [
        ...((input.devWalletOption === "generate" || input.devWalletOption === "system") &&
        devWalletPublicKey !== user.mainWallet.publicKey
          ? [devWalletKeypair]
          : []),
        ...bundlerWalletKeypairs,
        ...distributionWallets.map((wallet) => wallet.wallet),
      ];

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
      const {
        ataRentLamports,
        userVolumeAccumulatorRentLamports,
        buyRentLamports,
        distributionAtaLamports,
        creatorTargetLamports,
        devFundingLamports,
        bundlerFundingTargetLamports,
        totalBundlerFundingLamports,
        totalBundleBuyLamports,
        mainReserveLamports,
        tipLamports,
        fundingTargets,
      } = await buildLaunchFundingPlan({
        input,
        bundlerWalletCount,
        bundlerBuyAmountSol,
        bundlerBuyVariancePercent,
        distributionWalletMultiplier,
        devBuyAmountSol,
        jitoTipAmountSol,
        mainWalletPublicKey: user.mainWallet.publicKey,
        devWalletPublicKey,
        bundlerWalletPublicKeys: bundlerWalletKeypairs.map(
          (wallet) => wallet.publicKey
        ),
        bundlerBuyAmountLamportsByWallet:
          bundlerBuyAllocation.amountLamportsByWallet,
        allocationSeed: launchId,
        createFeeBufferLamports: CREATE_FEE_BUFFER_LAMPORTS,
        minCreatorBalanceLamports: MIN_CREATOR_BALANCE_LAMPORTS,
      });
      await appendLog(launchId, "INFO", "Funding plan prepared", "funding", {
        targetsCount: fundingTargets.length,
        devFundingLamports: devFundingLamports.toString(),
        creatorMinLamports: MIN_CREATOR_BALANCE_LAMPORTS.toString(),
        creatorTargetLamports: creatorTargetLamports.toString(),
        bundlerFundingTargetLamports: bundlerFundingTargetLamports.map(
          (lamports) => lamports.toString()
        ),
        totalBundlerFundingLamports: totalBundlerFundingLamports.toString(),
        totalBundleBuyLamports: totalBundleBuyLamports.toString(),
        ataRentLamports: ataRentLamports.toString(),
        userVolumeAccumulatorRentLamports:
          userVolumeAccumulatorRentLamports.toString(),
        buyRentLamports: buyRentLamports.toString(),
        distributionAtaLamports: distributionAtaLamports.toString(),
        mainReserveLamports: mainReserveLamports.toString(),
        tipLamports: tipLamports.toString(),
        bundlerBuyAllocationUsedFallback: bundlerBuyAllocation.usedFallback,
      });
      const fundingResult = await fundWalletsFromMain(
        launchId,
        mainWalletKeypair,
        fundingTargets,
        mainReserveLamports,
        user.id
      );
      fundedLaunchWallets = fundingResult.fundedWallets;
      await persistLaunchRecoveryFundingSnapshot(launchId, fundedLaunchWallets);

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
      reservedVanityId = mintReservation.reservedVanityId;
      await appendLog(launchId, "INFO", "Mint prepared", "mint", {
        durationMs: Date.now() - mintStartedAt,
        mintPublicKey: mintKeypair.publicKey.toBase58(),
        vanityMint: input.vanityMint,
        reservedVanityId,
      });

      if (await cancelLaunchIfRequested(launchId)) {
        return;
      }

      await updateProgress(launchId, 40, "persist");
      await appendLog(
        launchId,
        "STEP",
        "Saving pending token and wallet links",
        "persist"
      );
      const mintPublicKey = mintKeypair.publicKey.toBase58();
      const mintPrivateKey = bs58.encode(mintKeypair.secretKey);
      const persistStartedAt = Date.now();
      const tokenImageUrl = input.tokenImage;
      const { distributionWalletCount } = await persistTokenPending(
        input,
        tokenImageUrl || null,
        user.id,
        mintPublicKey,
        mintPrivateKey,
        devWalletPublicKey,
        bundlerWalletKeypairs,
        distributionWallets,
        reservedVanityId
      );
      persistedTokenPublicKey = mintPublicKey;
      await appendLog(launchId, "INFO", "Pending token saved", "persist", {
        tokenPublicKey: mintPublicKey,
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

      await setStep(launchId, 45, "create", "Creating token");
      const createStartedAt = Date.now();
      const pumpSdk = await createPumpSdk(devWalletKeypair);
      let createSignature: string | null = null;
      let bundleId: string | null = null;
      if (input.bundleBuyEnabled) {
        const buyerWallets = bundlerBuyAllocation.targets.map(
          (target) => target.wallet
        );
        const buyAmountsLamport = bundlerBuyAllocation.targets.map(
          (target) => target.amountLamports
        );
        const totalBuyLamports = bundlerBuyAllocation.targets.reduce(
          (total, target) => total + target.amountLamports,
          BigInt(0)
        );
        const baseTipLamports = Math.max(
          0,
          Math.floor(jitoTipAmountSol * LAMPORTS_PER_SOL)
        );
        await appendLog(launchId, "INFO", "Bundle buy prepared", "create", {
          buyers: buyerWallets.length,
          totalBuySol: lamportsToSol(totalBuyLamports).toFixed(4),
          totalBuyLamports: totalBuyLamports.toString(),
          tipLamports: baseTipLamports.toString(),
        });
        const bundleResult = await createAndBuyInBundle({
          launchId,
          userId: user.id,
          creator: devWalletKeypair,
          mint: mintKeypair,
          metadata,
          creatorBuyAmountLamport: toLamports(devBuyAmountSol),
          buyerWallets,
          buyAmountsLamport,
          tipper: mainWalletKeypair,
          tipLamports: baseTipLamports,
          adaptiveTipEscalation: {
            enabled: baseTipLamports > 0,
            multiplier: 2,
            maxEscalations: 1,
          },
          enableGrpc: grpcAccessService.getFeatureAccess(
            { plan: requestPlan },
            "bundle-fast-confirmation"
          ).allowed,
          onBundleEvent: async (event) => {
            await appendBundleTelemetryLog(launchId, event);
          },
        });
        createSignature = bundleResult.signatures[0] ?? null;
        bundleId = bundleResult.bundleId;
        await testRunLogService.appendServerEvent({
          eventType: "wallet_transaction",
          source: "launch.service",
          action: "launch.createAndBuyInBundle",
          launchId,
          wallets: [
            devWalletKeypair.publicKey.toBase58(),
            ...buyerWallets.map((wallet) => wallet.publicKey.toBase58()),
          ],
          status: "submitted",
          actualValue: {
            bundleId: bundleResult.bundleId,
            signatures: bundleResult.signatures,
          },
        });
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
          await appendLaunchDevBuyInstructions({
            createTx,
            buyer: devWalletKeypair,
            mint: mintKeypair.publicKey,
            solAmountLamports: toLamports(devBuyAmountSol),
            creator: devWalletKeypair.publicKey,
            minTokensOut: BigInt(1),
          });
        }
        if (!createTx.feePayer) {
          createTx.feePayer = devWalletKeypair.publicKey;
        }
        const latestBlockhash =
          await connection.getLatestBlockhash("confirmed");
        createTx.recentBlockhash = latestBlockhash.blockhash;
        const createTrackId = await appTransactionService
          .create({
            userId: user.id,
            type: "TRADE_CREATE",
            source: "LAUNCH",
            tokenPublicKey: mintPublicKey,
            walletPublicKey: devWalletKeypair.publicKey.toBase58(),
            fromAddress: devWalletKeypair.publicKey.toBase58(),
            referenceId: launchId,
          })
          .then((r) => r.id)
          .catch(() => null);
        const devBuyTrackId = devBuyAmountSol > 0
          ? await appTransactionService
              .create({
                userId: user.id,
                type: "TRADE_BUY",
                source: "LAUNCH",
                tokenPublicKey: mintPublicKey,
                walletPublicKey: devWalletKeypair.publicKey.toBase58(),
                fromAddress: devWalletKeypair.publicKey.toBase58(),
                solAmount: devBuyAmountSol,
                referenceId: launchId,
              })
              .then((r) => r.id)
              .catch(() => null)
          : null;
        createSignature = await sendAndConfirmTransaction(
          connection,
          createTx,
          [devWalletKeypair, mintKeypair],
          { commitment: "confirmed" }
        );
        if (createTrackId) await appTransactionService.confirm(createTrackId, { signature: createSignature }).catch(() => {});
        if (devBuyTrackId) await appTransactionService.confirm(devBuyTrackId, { signature: createSignature }).catch(() => {});
        await testRunLogService.appendServerEvent({
          eventType: "wallet_transaction",
          source: "launch.service",
          action: "launch.createToken",
          launchId,
          tokenPublicKey: mintPublicKey,
          wallets: [devWalletKeypair.publicKey.toBase58()],
          signature: createSignature,
          status: "submitted",
        });
        await appendLog(launchId, "INFO", "Create submitted", "create", {
          signature: createSignature,
          durationMs: Date.now() - createStartedAt,
        });
      }

      await setStep(launchId, 55, "confirm", "Confirming token on-chain");
      const confirmation = await waitForMintAccount(
        mintPublicKey,
        launchId,
        grpcAccessService.getFeatureAccess(
          { plan: requestPlan },
          "launch-fast-confirmation"
        ).allowed
      );
      if (reservedVanityId !== null) {
        await consumeReservedVanityMint(reservedVanityId, mintPublicKey);
        vanityConsumed = true;
      }
      await appendLog(launchId, "INFO", "Token confirmed", "confirm", {
        createSignature,
        bundleId,
        ...confirmation,
        vanityConsumed,
        reservedVanityId,
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
            const amountLamports =
              bundlerBuyAllocation.targets[i]?.amountLamports ?? BigInt(0);
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
            const buyTrackId = await appTransactionService
              .create({
                userId: user.id,
                type: "TRADE_BUY",
                source: "LAUNCH",
                tokenPublicKey: mintPublicKey,
                walletPublicKey: buyer.publicKey.toBase58(),
                fromAddress: buyer.publicKey.toBase58(),
                solAmount: Number(amountLamports) / 1_000_000_000,
                referenceId: launchId,
              })
              .then((r) => r.id)
              .catch(() => null);
            const signature = await sendAndConfirmTransaction(
              connection,
              tx,
              [buyer],
              {
                commitment: "confirmed",
              }
            );
            if (buyTrackId) await appTransactionService.confirm(buyTrackId, { signature }).catch(() => {});
            await testRunLogService.appendServerEvent({
              eventType: "wallet_transaction",
              source: "launch.service",
              action: "launch.bundleBuy",
              launchId,
              tokenPublicKey: mintPublicKey,
              wallets: [buyer.publicKey.toBase58()],
              signature,
              status: "submitted",
              expectedValue: {
                amountLamports: amountLamports.toString(),
              },
            });
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
          distributionWalletMultiplier,
          user.id
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

      launchReadyForSuccessRepair = true;
      await updateProgress(launchId, 80, "persist");
      await appendLog(launchId, "STEP", "Activating token", "persist");
      await activateToken(mintPublicKey);
      await appendLog(launchId, "INFO", "Token activated", "persist", {
        tokenPublicKey: mintPublicKey,
      });

      await setStep(launchId, 90, "cleanup", "Returning excess SOL");
      const solReturn = await returnExcessSolToMain(
        launchId,
        mainWalletKeypair,
        managedLaunchWallets,
        user.id,
        mintPublicKey
      );
      await appendLog(
        launchId,
        "INFO",
        "Excess SOL returned to main wallet",
        "cleanup",
        {
          attempted: solReturn.attempted,
          returned: solReturn.returned,
          failed: solReturn.failed,
          skipped: solReturn.skipped,
          totalReturnedSol: solReturn.totalReturnedSol,
          durationMs: solReturn.durationMs,
          results: solReturn.results,
        }
      );
      await testRunLogService.appendServerEvent({
        eventType: "funds_return",
        source: "launch.service",
        tokenPublicKey: mintPublicKey,
        action: "launch.cleanup",
        launchId,
        userId: user.id,
        wallets: managedLaunchWallets.map((wallet) =>
          wallet.publicKey.toBase58()
        ),
        actualValue: {
          attempted: solReturn.attempted,
          returned: solReturn.returned,
          failed: solReturn.failed,
          skipped: solReturn.skipped,
          totalReturnedSol: solReturn.totalReturnedSol,
        },
        balancesAfter: solReturn.results,
      });

      const returnedWalletPublicKeys = solReturn.results
        .filter((result) => result.status === "returned")
        .map((result) => result.publicKey);
      if (returnedWalletPublicKeys.length > 0) {
        const refreshWalletPublicKeys = Array.from(
          new Set([user.mainWallet.publicKey, ...returnedWalletPublicKeys])
        );
        try {
          await walletService.refreshWalletBalances(
            mintPublicKey,
            user.id,
            refreshWalletPublicKeys,
            true,
            "launch.cleanup"
          );
        } catch (error) {
          logger.warn("Launch success post-sweep balance refresh failed", {
            launchId,
            tokenPublicKey: mintPublicKey,
            message: getErrorMessage(error),
          });
        }
      }

      await finalizeLaunch(
        launchId,
        user.id,
        mintPublicKey,
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
        usageFees.totalFeeSol,
        jitoTipAmountSol,
        {
          attempted: solReturn.attempted,
          returned: solReturn.returned,
          failed: solReturn.failed,
          skipped: solReturn.skipped,
          totalReturnedSol: solReturn.totalReturnedSol,
          results: solReturn.results,
        },
        Date.now() - launchStartedAt
      );
    } catch (error) {
      if (
        launchReadyForSuccessRepair &&
        persistedTokenPublicKey &&
        recoveryData
      ) {
        await repairSuccessfulLaunchAfterError({
          launchId,
          tokenPublicKey: persistedTokenPublicKey,
          recovery: recoveryData,
          jitoTipAmountSol: input.jitoTipAmountSol,
          error,
        });
        return;
      }

      await finalizeLaunchFailure({
        launchId,
        error,
        launchStartedAt,
        persistedTokenPublicKey,
        reservedVanityId,
        vanityConsumed,
        recoveryData,
        mainWalletKeypair,
        managedLaunchWallets,
        fundedLaunchWallets,
        userId: launch.userId,
      });
    }
  },
};
