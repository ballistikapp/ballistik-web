import "server-only";
import { prisma } from "@/lib/prisma";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { AppError } from "@/server/errors";
import {
  referralCodeSchema,
  type LoginWithPrivateKeyInput,
  type AuthUserOutput,
  type UpdateNameInput,
  type CreateWalletChallengeInput,
  type LoginWithWalletSignatureInput,
  type LinkWalletAdapterInput,
} from "@/server/schemas";
import {
  AuthChallengePurpose,
  UserPlan,
  WalletType,
} from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { persistGeneratedPrivateKey } from "@/server/services/private-key-persistence.service";
import { signToken } from "@/lib/auth/jwt";
import { randomBytes } from "crypto";
import nacl from "tweetnacl";
import {
  addDays,
  createOpaqueRefreshToken,
  getRefreshTokenTtlDays,
  getSessionMaxTtlDays,
  hashRefreshToken,
} from "@/lib/auth/refresh-token";
import { SITE_BRAND_NAME } from "@/lib/config/site.config";
import {
  resolveEffectiveUserPlan,
  syncUserPlanState,
} from "@/server/services/pro-subscription.service";

type SessionRequestMeta = {
  clientIp?: string | null;
  userAgent?: string | null;
};

type SessionUser = Pick<
  AuthUserOutput,
  "id" | "name" | "plan" | "mainWalletPublicKey" | "authWalletPublicKey"
>;

const WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000;

function createWalletAuthMessage(input: {
  publicKey: string;
  nonce: string;
  purpose: AuthChallengePurpose;
}) {
  const action =
    input.purpose === AuthChallengePurpose.WALLET_LINK
      ? "Link this wallet to your BALLISTIK account."
      : "Sign in to BALLISTIK.";

  return [
    action,
    "",
    `Wallet: ${input.publicKey}`,
    `Nonce: ${input.nonce}`,
    "Only sign this message if you trust this site.",
  ].join("\n");
}

function validateSolanaPublicKey(publicKey: string) {
  try {
    return new PublicKey(publicKey).toBase58();
  } catch {
    throw new AppError("Invalid wallet public key", 400);
  }
}

function generateMainWallet() {
  const keypair = Keypair.generate();
  const privateKey = bs58.encode(keypair.secretKey);
  const publicKey = keypair.publicKey.toBase58();
  return { keypair, privateKey, publicKey };
}

function sanitizeMeta(meta?: SessionRequestMeta) {
  const ip = meta?.clientIp?.trim() || null;
  const userAgent = meta?.userAgent?.trim() || null;
  return { ip, userAgent };
}

export const authService = {
  async loginWithPrivateKey(
    input: LoginWithPrivateKeyInput
  ): Promise<AuthUserOutput> {
    try {
      let keypair: Keypair;
      try {
        const secretKey = bs58.decode(input.privateKey);
        keypair = Keypair.fromSecretKey(secretKey);
      } catch {
        throw new AppError("Invalid private key format", 400);
      }

      const publicKey = keypair.publicKey.toBase58();

      const wallet = await prisma.wallet.findUnique({
        where: { publicKey },
      });

      if (!wallet) {
        throw new AppError("Wallet not found", 404);
      }

      if (wallet.privateKey !== input.privateKey) {
        throw new AppError("Invalid private key", 401);
      }

      const user = await prisma.user.findUnique({
        where: { mainWalletPublicKey: publicKey },
      });

      if (!user) {
        throw new AppError("User not found", 404);
      }

      return {
        id: user.id,
        name: user.name,
        plan: resolveEffectiveUserPlan(user.plan, user.paidPlanExpiresAt),
        mainWalletPublicKey: user.mainWalletPublicKey,
        authWalletPublicKey: user.authWalletPublicKey,
        mainWalletBalanceSol: Number(wallet.balanceSol ?? 0),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error("Login error", error);
      throw new AppError("Failed to login", 500, { error });
    }
  },

  async createWalletChallenge(input: CreateWalletChallengeInput) {
    const publicKey = validateSolanaPublicKey(input.publicKey);
    const purpose = input.purpose as AuthChallengePurpose;
    const nonce = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + WALLET_CHALLENGE_TTL_MS);
    const message = createWalletAuthMessage({ publicKey, nonce, purpose });

    await prisma.authChallenge.create({
      data: {
        publicKey,
        nonce,
        purpose,
        expiresAt,
      },
    });

    return {
      publicKey,
      nonce,
      purpose,
      message,
      expiresAt,
    };
  },

  async loginWithWalletSignature(
    input: LoginWithWalletSignatureInput
  ): Promise<AuthUserOutput> {
    const authWalletPublicKey = await this.verifyWalletChallenge({
      publicKey: input.publicKey,
      nonce: input.nonce,
      signature: input.signature,
      purpose: AuthChallengePurpose.WALLET_LOGIN,
    });

    const linkedUser = await prisma.user.findUnique({
      where: { authWalletPublicKey },
      select: {
        id: true,
        name: true,
        plan: true,
        paidPlanExpiresAt: true,
        mainWalletPublicKey: true,
        authWalletPublicKey: true,
        createdAt: true,
        updatedAt: true,
        mainWallet: {
          select: { balanceSol: true },
        },
      },
    });

    if (linkedUser) {
      return {
        id: linkedUser.id,
        name: linkedUser.name,
        plan: resolveEffectiveUserPlan(
          linkedUser.plan,
          linkedUser.paidPlanExpiresAt
        ),
        mainWalletPublicKey: linkedUser.mainWalletPublicKey,
        authWalletPublicKey: linkedUser.authWalletPublicKey,
        mainWalletBalanceSol: Number(linkedUser.mainWallet?.balanceSol ?? 0),
        createdAt: linkedUser.createdAt,
        updatedAt: linkedUser.updatedAt,
      };
    }

    const legacyUser = await prisma.user.findUnique({
      where: { mainWalletPublicKey: authWalletPublicKey },
      select: { id: true },
    });

    if (legacyUser) {
      throw new AppError(
        "This wallet belongs to an existing account. Sign in with your private key first, then link wallet login from Account.",
        409
      );
    }

    const managedWallet = await prisma.wallet.findUnique({
      where: { publicKey: authWalletPublicKey },
      select: { publicKey: true },
    });

    if (managedWallet) {
      throw new AppError(
        `This wallet is already managed by ${SITE_BRAND_NAME}. Choose a different connected wallet for wallet login.`,
        409
      );
    }

    if (input.intent === "login") {
      throw new AppError(
        "No account is linked to this wallet. Create an account first or sign in with your private key.",
        404
      );
    }

    const generated = generateMainWallet();
    await persistGeneratedPrivateKey({
      service: "authService",
      operation: "loginWithWalletSignature.createMainWallet",
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
    });

    const accountName =
      input.accountName?.trim() ||
      `${authWalletPublicKey.slice(0, 4)}-${authWalletPublicKey.slice(-4)}`;

    const referralCodeParse = referralCodeSchema.safeParse(
      input.referralCode ?? ""
    );
    const referralCode = referralCodeParse.success
      ? referralCodeParse.data
      : undefined;

    const user = await prisma.$transaction(async (tx) => {
      await tx.wallet.create({
        data: {
          publicKey: generated.publicKey,
          privateKey: generated.privateKey,
          type: WalletType.MAIN_WALLET,
          isImported: false,
        },
      });

      const createdUser = await tx.user.create({
        data: {
          name: accountName,
          plan: UserPlan.FREE,
          mainWalletPublicKey: generated.publicKey,
          authWalletPublicKey,
        },
      });

      // Register-only sticky Referral (ADR 0005). Missing / unknown / disabled
      // codes are ignored so signup is never blocked by a marketing link.
      if (referralCode) {
        const marketer = await tx.marketer.findUnique({
          where: { referralCode },
          select: { id: true, isEnabled: true },
        });
        if (marketer?.isEnabled) {
          await tx.referral.create({
            data: {
              marketerId: marketer.id,
              userId: createdUser.id,
            },
          });
        }
      }

      return createdUser;
    });

    return {
      id: user.id,
      name: user.name,
      plan: user.plan,
      mainWalletPublicKey: user.mainWalletPublicKey,
      authWalletPublicKey: user.authWalletPublicKey,
      mainWalletBalanceSol: 0,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      generatedWallet: {
        publicKey: generated.publicKey,
        privateKey: generated.privateKey,
      },
    };
  },

  async linkWalletAdapter(userId: string, input: LinkWalletAdapterInput) {
    const authWalletPublicKey = await this.verifyWalletChallenge({
      publicKey: input.publicKey,
      nonce: input.nonce,
      signature: input.signature,
      purpose: AuthChallengePurpose.WALLET_LINK,
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        plan: true,
        mainWalletPublicKey: true,
        authWalletPublicKey: true,
      },
    });

    if (!user) {
      throw new AppError("User not found", 404);
    }

    if (user.authWalletPublicKey === authWalletPublicKey) {
      return user;
    }

    if (user.authWalletPublicKey) {
      throw new AppError("Wallet login is already linked", 400);
    }

    const existingLink = await prisma.user.findUnique({
      where: { authWalletPublicKey },
      select: { id: true },
    });

    if (existingLink && existingLink.id !== userId) {
      throw new AppError("This wallet is already linked to another account", 409);
    }

    const mainWalletUser = await prisma.user.findUnique({
      where: { mainWalletPublicKey: authWalletPublicKey },
      select: { id: true },
    });

    if (mainWalletUser && mainWalletUser.id !== userId) {
      throw new AppError(
        "This wallet belongs to another existing account. Choose a different connected wallet.",
        409
      );
    }

    const managedWallet = await prisma.wallet.findUnique({
      where: { publicKey: authWalletPublicKey },
      select: { publicKey: true },
    });

    if (managedWallet && authWalletPublicKey !== user.mainWalletPublicKey) {
      throw new AppError(
        `This wallet is already managed by ${SITE_BRAND_NAME}. Choose a different connected wallet.`,
        409
      );
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { authWalletPublicKey },
      select: {
        id: true,
        name: true,
        plan: true,
        mainWalletPublicKey: true,
        authWalletPublicKey: true,
      },
    });

    return updated;
  },

  async verifyWalletChallenge(input: {
    publicKey: string;
    nonce: string;
    signature: string;
    purpose: AuthChallengePurpose;
  }) {
    const publicKey = validateSolanaPublicKey(input.publicKey);
    const now = new Date();

    const challenge = await prisma.authChallenge.findUnique({
      where: { nonce: input.nonce },
    });

    if (
      !challenge ||
      challenge.publicKey !== publicKey ||
      challenge.purpose !== input.purpose ||
      challenge.consumedAt ||
      challenge.expiresAt <= now
    ) {
      throw new AppError("Invalid or expired wallet challenge", 401);
    }

    const message = createWalletAuthMessage({
      publicKey,
      nonce: challenge.nonce,
      purpose: challenge.purpose,
    });

    let signature: Uint8Array;
    try {
      signature = bs58.decode(input.signature);
    } catch {
      throw new AppError("Invalid wallet signature", 400);
    }

    const verified = nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      signature,
      new PublicKey(publicKey).toBytes()
    );

    if (!verified) {
      throw new AppError("Invalid wallet signature", 401);
    }

    const consumed = await prisma.authChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
      },
      data: {
        consumedAt: now,
      },
    });

    if (consumed.count !== 1) {
      throw new AppError("Wallet challenge already used", 401);
    }

    return publicKey;
  },

  async updateName(userId: string, input: UpdateNameInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new AppError("User not found", 404);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { name: input.name.trim() },
      select: {
        id: true,
        name: true,
        plan: true,
        mainWalletPublicKey: true,
        authWalletPublicKey: true,
      },
    });

    return updated;
  },

  async createSession(user: SessionUser, meta?: SessionRequestMeta) {
    const now = new Date();
    const { ip, userAgent } = sanitizeMeta(meta);
    const refreshTtlDays = getRefreshTokenTtlDays();
    const sessionTtlDays = getSessionMaxTtlDays();
    const sessionExpiresAt = addDays(now, sessionTtlDays);
    const refreshExpiresAt = addDays(now, Math.min(refreshTtlDays, sessionTtlDays));
    const refreshToken = createOpaqueRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);

    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        ip,
        userAgent,
        lastSeenAt: now,
        expiresAt: sessionExpiresAt,
      },
    });

    await prisma.refreshToken.create({
      data: {
        sessionId: session.id,
        tokenHash: refreshTokenHash,
        expiresAt: refreshExpiresAt,
      },
    });

    logger.info("Auth session created", {
      userId: user.id,
      sessionId: session.id,
      refreshExpiresAt,
      sessionExpiresAt,
      clientIp: ip,
    });

    return {
      sessionId: session.id,
      accessToken: signToken(
        user.id,
        user.mainWalletPublicKey,
        user.name,
        user.plan,
        user.authWalletPublicKey
      ),
      refreshToken,
      refreshExpiresAt,
      sessionExpiresAt,
    };
  },

  async refreshSession(refreshToken: string, meta?: SessionRequestMeta) {
    const tokenHash = hashRefreshToken(refreshToken);
    const now = new Date();
    const { ip, userAgent } = sanitizeMeta(meta);
    const refreshTtlDays = getRefreshTokenTtlDays();
    const sessionTtlDays = getSessionMaxTtlDays();

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: {
          session: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  plan: true,
                  paidPlanExpiresAt: true,
                  mainWalletPublicKey: true,
                  authWalletPublicKey: true,
                },
              },
            },
          },
        },
      });

      if (!current) {
        logger.warn("Refresh session failed: token not found");
        throw new AppError("Invalid refresh session", 401);
      }

      const session = current.session;
      if (
        current.revokedAt ||
        current.expiresAt <= now ||
        session.revokedAt ||
        session.expiresAt <= now
      ) {
        logger.warn("Refresh session failed: token expired or revoked", {
          sessionId: session.id,
        });
        throw new AppError("Refresh session expired", 401);
      }

      if (current.usedAt) {
        await tx.authSession.update({
          where: { id: session.id },
          data: {
            revokedAt: now,
          },
        });
        await tx.refreshToken.updateMany({
          where: {
            sessionId: session.id,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
          },
        });
        logger.warn("Refresh session failed: token reuse detected", {
          sessionId: session.id,
        });
        throw new AppError("Refresh token reuse detected", 401);
      }

      const nextRefreshToken = createOpaqueRefreshToken();
      const nextRefreshTokenHash = hashRefreshToken(nextRefreshToken);
      const candidateRefreshExpiresAt = addDays(
        now,
        Math.min(refreshTtlDays, sessionTtlDays)
      );
      const refreshExpiresAt =
        candidateRefreshExpiresAt < session.expiresAt
          ? candidateRefreshExpiresAt
          : session.expiresAt;

      const replacement = await tx.refreshToken.create({
        data: {
          sessionId: session.id,
          tokenHash: nextRefreshTokenHash,
          expiresAt: refreshExpiresAt,
        },
      });

      await tx.refreshToken.update({
        where: { id: current.id },
        data: {
          usedAt: now,
          replacedById: replacement.id,
        },
      });

      await tx.authSession.update({
        where: { id: session.id },
        data: {
          lastSeenAt: now,
          ip,
          userAgent,
        },
      });

      const effectivePlan = await syncUserPlanState(
        tx,
        session.user.id,
        session.user.plan,
        session.user.paidPlanExpiresAt,
        now
      );

      return {
        sessionId: session.id,
        refreshToken: nextRefreshToken,
        refreshExpiresAt,
        user: {
          ...session.user,
          plan: effectivePlan,
        },
      };
    });

    logger.info("Auth session refreshed", {
      sessionId: result.sessionId,
      clientIp: ip,
    });

    return {
      ...result,
      accessToken: signToken(
        result.user.id,
        result.user.mainWalletPublicKey,
        result.user.name,
        result.user.plan,
        result.user.authWalletPublicKey
      ),
    };
  },

  async revokeSession(sessionId: string, userId?: string) {
    const now = new Date();
    const updated = await prisma.authSession.updateMany({
      where: {
        id: sessionId,
        ...(userId ? { userId } : {}),
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    if (updated.count > 0) {
      await prisma.refreshToken.updateMany({
        where: {
          sessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });
      logger.info("Auth session revoked", { sessionId, userId });
    }

    return updated.count > 0;
  },

  async revokeSessionByRefreshToken(refreshToken: string) {
    const tokenHash = hashRefreshToken(refreshToken);
    const token = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        sessionId: true,
      },
    });

    if (!token) {
      return false;
    }

    return await this.revokeSession(token.sessionId);
  },

  async revokeAllSessions(userId: string) {
    const now = new Date();
    await prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    await prisma.refreshToken.updateMany({
      where: {
        session: {
          userId,
        },
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });
    logger.info("All auth sessions revoked", { userId });
  },

  async getUserById(id: string): Promise<AuthUserOutput | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          plan: true,
          paidPlanExpiresAt: true,
          authWalletPublicKey: true,
          mainWalletPublicKey: true,
          createdAt: true,
          updatedAt: true,
          mainWallet: {
            select: {
              balanceSol: true,
            },
          },
        },
      });

      if (!user) {
        return null;
      }

      return {
        id: user.id,
        name: user.name,
        plan: resolveEffectiveUserPlan(user.plan, user.paidPlanExpiresAt),
        mainWalletPublicKey: user.mainWalletPublicKey,
        authWalletPublicKey: user.authWalletPublicKey,
        mainWalletBalanceSol: Number(user.mainWallet?.balanceSol ?? 0),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
    } catch (error) {
      logger.error("Get user error", error);
      return null;
    }
  },
};
