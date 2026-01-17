import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { AppError } from "@/server/errors";
import { logger } from "@/lib/logger";
import type { LaunchTokenInput } from "@/server/schemas/launch.schema";
import { getSolanaConnection } from "@/lib/solana/connection";
import { AnchorProvider } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { PumpFunSDK, type CreateTokenMetadata } from "pumpdotfun-sdk";

const SLIPPAGE_BASIS_POINTS = BigInt(10000);
const MIN_BUY_AMOUNT_SOL = 0.003;

type LaunchLogLevel = "INFO" | "WARN" | "ERROR" | "STEP";

function toLamports(amount: number) {
  return BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
}

function parseNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
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
  const context: Record<string, unknown> = { launchId, level, step };
  if (data && typeof data === "object" && !Array.isArray(data)) {
    Object.assign(context, data as Record<string, unknown>);
  }
  logger.info(message, context);
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

    return launch;
  },

  async getActiveLaunch(userId: string) {
    return prisma.launch.findFirst({
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

    const input = launch.input as LaunchTokenInput;
    let reservedVanityId: string | null = null;

    try {
      await appendLog(launchId, "STEP", "Validating input", "validate");

      const devBuyAmount = parseNumber(input.devBuyAmount, 0);
      const jitoTipAmount = parseNumber(input.jitoTipAmount, 0);
      const numberOfWallets = Math.max(
        0,
        Math.floor(parseNumber(input.numberOfWallets, 0))
      );
      const buyAmountPerWallet = parseNumber(input.buyAmountPerWallet, 0);
      const buyAmountVariance = parseNumber(input.buyAmountVariance, 0);
      const distributionMultiplier = Math.max(
        1,
        Math.floor(parseNumber(input.distributionMultiplier, 1))
      );

      if (devBuyAmount > 0 && devBuyAmount < MIN_BUY_AMOUNT_SOL) {
        throw new AppError(
          `Dev buy must be at least ${MIN_BUY_AMOUNT_SOL} SOL`,
          400
        );
      }
      if (buyAmountPerWallet > 0 && buyAmountPerWallet < MIN_BUY_AMOUNT_SOL) {
        throw new AppError(
          `Buy amount per wallet must be at least ${MIN_BUY_AMOUNT_SOL} SOL`,
          400
        );
      }

      await updateProgress(launchId, 6, "wallets");
      await appendLog(launchId, "STEP", "Loading wallets", "wallets");

      const user = await prisma.user.findUnique({
        where: { id: launch.userId },
        include: { mainWallet: true },
      });

      if (!user?.mainWallet) {
        throw new AppError("Main wallet not found", 400);
      }

      const mainWalletKeypair = Keypair.fromSecretKey(
        bs58.decode(user.mainWallet.privateKey)
      );

      let devWalletKeypair = mainWalletKeypair;
      let devWalletPublicKey = user.mainWallet.publicKey;

      if (input.devWalletOption === "import") {
        if (!input.importedDevWalletKey?.trim()) {
          throw new AppError("Dev wallet private key is required", 400);
        }
        devWalletKeypair = Keypair.fromSecretKey(
          bs58.decode(input.importedDevWalletKey.trim())
        );
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
              userId: user.id,
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
            userId: user.id,
          },
        });
      }

      const bundlerWalletKeypairs: Keypair[] = [];
      if (input.bundleBuyEnabled && numberOfWallets > 0) {
        for (let i = 0; i < numberOfWallets; i += 1) {
          bundlerWalletKeypairs.push(Keypair.generate());
        }
        await prisma.wallet.createMany({
          data: bundlerWalletKeypairs.map((wallet) => ({
            publicKey: wallet.publicKey.toBase58(),
            privateKey: bs58.encode(wallet.secretKey),
            type: "BUNDLER",
            userId: user.id,
          })),
        });
      }

      if (await isCancelRequested(launchId)) {
        await appendLog(launchId, "WARN", "Launch canceled", "cancel");
        await prisma.launch.update({
          where: { id: launchId },
          data: { status: "CANCELED", completedAt: new Date() },
        });
        return;
      }

      await updateProgress(launchId, 18, "metadata");
      await appendLog(launchId, "STEP", "Preparing metadata", "metadata");

      const file = await resolveImageFile(input.tokenImage, input.tokenSymbol);
      const metadata = buildTokenMetadata(input, file);

      await updateProgress(launchId, 30, "mint");
      await appendLog(launchId, "STEP", "Preparing mint", "mint");

      let mintKeypair = Keypair.generate();
      if (input.vanityMint) {
        const reserved = await reserveVanityMint(user.id);
        if (reserved) {
          reservedVanityId = reserved.id;
          mintKeypair = Keypair.fromSecretKey(bs58.decode(reserved.privateKey));
          await appendLog(launchId, "INFO", "Using vanity mint", "mint", {
            publicKey: reserved.publicKey,
          });
        } else {
          await appendLog(
            launchId,
            "WARN",
            "No vanity mint available, using random",
            "mint"
          );
        }
      }

      if (await isCancelRequested(launchId)) {
        await appendLog(launchId, "WARN", "Launch canceled", "cancel");
        await prisma.launch.update({
          where: { id: launchId },
          data: { status: "CANCELED", completedAt: new Date() },
        });
        if (reservedVanityId) {
          await releaseVanityMint(reservedVanityId);
        }
        return;
      }

      await updateProgress(launchId, 45, "create");
      await appendLog(launchId, "STEP", "Creating token", "create");

      const pumpSdk = await createPumpSdk(devWalletKeypair);
      const createResult = await pumpSdk.createAndBuy(
        devWalletKeypair,
        mintKeypair,
        metadata,
        toLamports(devBuyAmount)
      );

      await appendLog(launchId, "INFO", "Token created", "create", {
        signature: (createResult as { signature?: string })?.signature,
      });

      const mintPublicKey = mintKeypair.publicKey.toBase58();
      const mintPrivateKey = bs58.encode(mintKeypair.secretKey);

      await updateProgress(launchId, 65, "buys");
      await appendLog(launchId, "STEP", "Executing bundle buys", "buys");

      if (input.bundleBuyEnabled && bundlerWalletKeypairs.length > 0) {
        const connection = getSolanaConnection();
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
          const variance = buyAmountPerWallet * (buyAmountVariance / 100);
          const amount = Math.max(
            0,
            buyAmountPerWallet + (Math.random() * 2 - 1) * variance
          );
          const amountLamports = toLamports(amount);
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

          await appendLog(launchId, "INFO", "Bundle buy executed", "buys", {
            wallet: buyer.publicKey.toBase58(),
            amount,
            signature,
          });
        }
      }

      await updateProgress(launchId, 80, "persist");
      await appendLog(launchId, "STEP", "Saving token", "persist");

      const token = await prisma.token.create({
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
          userId: user.id,
          wallets: {
            connect: [
              { publicKey: user.mainWallet.publicKey },
              { publicKey: devWalletPublicKey },
              ...bundlerWalletKeypairs.map((wallet) => ({
                publicKey: wallet.publicKey.toBase58(),
              })),
            ],
          },
        },
      });

      if (reservedVanityId) {
        await prisma.vanityMint.update({
          where: { id: reservedVanityId },
          data: {
            usedAt: new Date(),
            tokenPublicKey: token.publicKey,
          },
        });
      }

      if (distributionMultiplier > 1) {
        const distributionWallets: Keypair[] = [];
        const total =
          bundlerWalletKeypairs.length * (distributionMultiplier - 1);
        for (let i = 0; i < total; i += 1) {
          distributionWallets.push(Keypair.generate());
        }
        if (distributionWallets.length > 0) {
          await prisma.wallet.createMany({
            data: distributionWallets.map((wallet) => ({
              publicKey: wallet.publicKey.toBase58(),
              privateKey: bs58.encode(wallet.secretKey),
              type: "DISTRIBUTION",
              userId: user.id,
            })),
          });
          await prisma.token.update({
            where: { publicKey: token.publicKey },
            data: {
              wallets: {
                connect: distributionWallets.map((wallet) => ({
                  publicKey: wallet.publicKey.toBase58(),
                })),
              },
            },
          });
          await appendLog(
            launchId,
            "INFO",
            "Distribution wallets generated",
            "distribution",
            {
              count: distributionWallets.length,
            }
          );
        }
      }

      const finalStatus = (await isCancelRequested(launchId))
        ? "CANCELED"
        : "SUCCEEDED";

      await prisma.launch.update({
        where: { id: launchId },
        data: {
          status: finalStatus,
          progress: 100,
          completedAt: new Date(),
          tokenPublicKey: token.publicKey,
          result: {
            tokenPublicKey: token.publicKey,
            devWalletPublicKey,
            mainWalletPublicKey: user.mainWallet.publicKey,
            bundlerWallets: bundlerWalletKeypairs.map((wallet) =>
              wallet.publicKey.toBase58()
            ),
            jitoTipAmount,
          },
        },
      });

      await appendLog(launchId, "INFO", "Launch complete", "complete", {
        status: finalStatus,
        tokenPublicKey: token.publicKey,
      });
    } catch (error) {
      if (reservedVanityId) {
        await releaseVanityMint(reservedVanityId);
      }
      const message = error instanceof Error ? error.message : "Launch failed";
      await prisma.launch.update({
        where: { id: launchId },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      });
      await appendLog(launchId, "ERROR", message, "error");
    }
  },
};
