import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { AppError } from "@/server/errors";
import { getServerUser } from "@/lib/utils/auth";
import type { CreateTokenInput } from "@/server/schemas/token.schema";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getEnv } from "@/lib/config/env";
import { shyftCallbackService } from "@/server/services/shyft-callback.service";
import { derivePumpAddresses } from "@/server/solana/pump-new-idl";
import { logger } from "@/lib/logger";
import { persistGeneratedPrivateKey } from "@/server/services/private-key-persistence.service";
import type { TokenListPaginationInput } from "@/server/schemas/token.schema";

const DEFAULT_TOKEN_PAGE = 1;
const DEFAULT_TOKEN_PAGE_SIZE = 50;
const MAX_TOKEN_PAGE_SIZE = 100;

const tokenPublicSelect = {
  publicKey: true,
  status: true,
  name: true,
  symbol: true,
  description: true,
  imageUrl: true,
  websiteUrl: true,
  twitterUrl: true,
  telegramUrl: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
} satisfies Prisma.TokenSelect;

export const tokenService = {
  async getUserTokens(
    userId?: string,
    pagination?: TokenListPaginationInput
  ) {
    try {
      let _userId = userId;
      if (!_userId) {
        const user = await getServerUser();
        _userId = user?.id;
      }
      if (!_userId) {
        return {
          items: [],
          totalCount: 0,
          page: DEFAULT_TOKEN_PAGE,
          pageSize: DEFAULT_TOKEN_PAGE_SIZE,
        };
      }
      const page = pagination?.page ?? DEFAULT_TOKEN_PAGE;
      const pageSize = Math.min(
        pagination?.pageSize ?? DEFAULT_TOKEN_PAGE_SIZE,
        MAX_TOKEN_PAGE_SIZE
      );
      const skip = (page - 1) * pageSize;
      const where = {
        userId: _userId,
        status: "ACTIVE" as const,
      };
      const [items, totalCount] = await Promise.all([
        prisma.token.findMany({
          where,
          select: tokenPublicSelect,
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
        }),
        prisma.token.count({ where }),
      ]);
      return {
        items,
        totalCount,
        page,
        pageSize,
      };
    } catch (error) {
      throw new AppError("Failed to fetch user tokens", 500, { error });
    }
  },

  async getAllUserTokens(
    userId?: string,
    pagination?: TokenListPaginationInput
  ) {
    try {
      let _userId = userId;
      if (!_userId) {
        const user = await getServerUser();
        _userId = user?.id;
      }
      if (!_userId) {
        return {
          items: [],
          totalCount: 0,
          page: DEFAULT_TOKEN_PAGE,
          pageSize: DEFAULT_TOKEN_PAGE_SIZE,
        };
      }
      const page = pagination?.page ?? DEFAULT_TOKEN_PAGE;
      const pageSize = Math.min(
        pagination?.pageSize ?? DEFAULT_TOKEN_PAGE_SIZE,
        MAX_TOKEN_PAGE_SIZE
      );
      const skip = (page - 1) * pageSize;
      const where = { userId: _userId };
      const [items, totalCount] = await Promise.all([
        prisma.token.findMany({
          where,
          select: tokenPublicSelect,
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
        }),
        prisma.token.count({ where }),
      ]);
      return {
        items,
        totalCount,
        page,
        pageSize,
      };
    } catch (error) {
      throw new AppError("Failed to fetch user tokens", 500, { error });
    }
  },

  async createToken(input: CreateTokenInput, userId: string) {
    try {
      const keypair = Keypair.generate();
      const publicKey = keypair.publicKey.toBase58();
      const privateKey = bs58.encode(keypair.secretKey);
      await persistGeneratedPrivateKey({
        service: "tokenService",
        operation: "createToken",
        publicKey,
        privateKey,
      });

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
        select: tokenPublicSelect,
      });

      const { SHYFT_API_KEY, APP_URL } = getEnv();
      if (SHYFT_API_KEY && APP_URL) {
        const callbackUrl = `${APP_URL}/api/webhooks/shyft`;
        try {
          await shyftCallbackService.createAccountCallback({
            address: publicKey,
            callbackUrl,
            projectId: publicKey,
          });
          const mint = new PublicKey(publicKey);
          const { bondingCurve } = derivePumpAddresses(mint);
          await shyftCallbackService.createAccountCallback({
            address: bondingCurve.toBase58(),
            callbackUrl,
            projectId: publicKey,
          });
          await shyftCallbackService.createTransactionCallback({
            address: publicKey,
            callbackUrl,
            projectId: publicKey,
            events: ["SWAP", "TOKEN_TRANSFER", "SOL_TRANSFER"],
          });
          await shyftCallbackService.createTransactionCallback({
            address: bondingCurve.toBase58(),
            callbackUrl,
            projectId: publicKey,
            events: ["SWAP", "TOKEN_TRANSFER", "SOL_TRANSFER"],
          });
        } catch (error) {
          logger.warn("Failed to register Shyft callbacks for token", {
            tokenPublicKey: publicKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

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
      select: tokenPublicSelect,
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    return token;
  },

  async getTokenPrivateKeyByPublicKey(publicKey: string, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey, userId },
      select: { privateKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    return { privateKey: token.privateKey };
  },
};

export type UserTokensOutput = Awaited<
  ReturnType<typeof tokenService.getUserTokens>
>;
export type UserTokenItems = UserTokensOutput["items"];
