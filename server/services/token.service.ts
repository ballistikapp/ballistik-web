import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import { getServerUser } from "@/lib/utils/auth";
import type { CreateTokenInput } from "@/server/schemas/token.schema";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export const tokenService = {
  async getUserTokens(userId?: string) {
    try {
      let _userId = userId;
      if (!_userId) {
        const user = await getServerUser();
        _userId = user?.id;
      }
      if (!_userId) {
        return [];
      }
      return await prisma.token.findMany({
        where: { userId: _userId },
      });
    } catch (error) {
      throw new AppError("Failed to fetch user tokens", 500, { error });
    }
  },

  async createToken(input: CreateTokenInput, userId: string) {
    try {
      const keypair = Keypair.generate();
      const publicKey = keypair.publicKey.toBase58();
      const privateKey = bs58.encode(keypair.secretKey);

      const token = await prisma.token.create({
        data: {
          publicKey,
          privateKey,
          name: input.tokenName,
          symbol: input.tokenSymbol,
          description: input.description || null,
          imageUrl: input.tokenImage || null,
          twitterUrl: input.twitter || null,
          telegramUrl: input.telegram || null,
          websiteUrl: input.website || null,
          userId,
        },
      });

      return token;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Unique constraint")) {
          throw new AppError("Token with this keypair already exists", 409);
        }
      }
      throw new AppError("Failed to create token", 500, { error });
    }
  },

  async getTokenByPublicKey(publicKey: string, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey, userId },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    return token;
  },
};

export type UserTokensOutput = Awaited<
  ReturnType<typeof tokenService.getUserTokens>
>;
