import { prisma } from "@/lib/prisma";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { AppError } from "@/server/errors";
import type {
  RegisterInput,
  LoginWithPrivateKeyInput,
  AuthUserOutput,
  UpdateNameInput,
} from "@/server/schemas";
import { WalletType } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { persistGeneratedPrivateKey } from "@/server/services/private-key-persistence.service";
import { signToken } from "@/lib/auth/jwt";
import {
  addDays,
  createOpaqueRefreshToken,
  getRefreshTokenTtlDays,
  getSessionMaxTtlDays,
  hashRefreshToken,
} from "@/lib/auth/refresh-token";

type SessionRequestMeta = {
  clientIp?: string | null;
  userAgent?: string | null;
};

type SessionUser = Pick<AuthUserOutput, "id" | "name" | "mainWalletPublicKey">;

function sanitizeMeta(meta?: SessionRequestMeta) {
  const ip = meta?.clientIp?.trim() || null;
  const userAgent = meta?.userAgent?.trim() || null;
  return { ip, userAgent };
}

export const authService = {
  async register(input: RegisterInput): Promise<AuthUserOutput> {
    try {
      let keypair: Keypair;
      let privateKey: string;
      let publicKey: string;
      let isGenerated = false;

      if (input.generateWallet) {
        keypair = Keypair.generate();
        privateKey = bs58.encode(keypair.secretKey);
        publicKey = keypair.publicKey.toBase58();
        await persistGeneratedPrivateKey({
          service: "authService",
          operation: "register",
          publicKey,
          privateKey,
        });
        isGenerated = true;
      } else {
        try {
          const secretKey = bs58.decode(input.privateKey!);
          keypair = Keypair.fromSecretKey(secretKey);
          privateKey = input.privateKey!;
          publicKey = keypair.publicKey.toBase58();
        } catch (error) {
          throw new AppError("Invalid private key format", 400);
        }
      }

      const existingWallet = await prisma.wallet.findUnique({
        where: { publicKey },
      });

      if (existingWallet) {
        throw new AppError("Wallet already exists", 400);
      }

      const existingUser = await prisma.user.findUnique({
        where: { mainWalletPublicKey: publicKey },
      });

      if (existingUser) {
        throw new AppError("User already exists with this wallet", 400);
      }

      await prisma.wallet.create({
        data: {
          publicKey,
          privateKey,
          type: WalletType.MAIN_WALLET,
          isImported: !isGenerated,
        },
      });

      const accountName =
        input.accountName?.trim() ||
        `${publicKey.slice(0, 4)}-${publicKey.slice(-4)}`;

      const user = await prisma.user.create({
        data: {
          name: accountName,
          mainWalletPublicKey: publicKey,
        },
      });

      const result: AuthUserOutput = {
        id: user.id,
        name: user.name,
        mainWalletPublicKey: user.mainWalletPublicKey,
        mainWalletBalanceSol: 0,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };

      if (isGenerated) {
        result.generatedWallet = {
          publicKey,
          privateKey,
        };
      }

      return result;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error("Registration error", error);
      throw new AppError("Failed to register user", 500, { error });
    }
  },

  async loginWithPrivateKey(
    input: LoginWithPrivateKeyInput
  ): Promise<AuthUserOutput> {
    try {
      let keypair: Keypair;
      try {
        const secretKey = bs58.decode(input.privateKey);
        keypair = Keypair.fromSecretKey(secretKey);
      } catch (error) {
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
        mainWalletPublicKey: user.mainWalletPublicKey,
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
      select: { id: true, name: true, mainWalletPublicKey: true },
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
      accessToken: signToken(user.id, user.mainWalletPublicKey, user.name),
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
                  mainWalletPublicKey: true,
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

      return {
        sessionId: session.id,
        refreshToken: nextRefreshToken,
        refreshExpiresAt,
        user: session.user,
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
        result.user.name
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
        mainWalletPublicKey: user.mainWalletPublicKey,
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
