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
