import "server-only";
import { prisma } from "@/lib/prisma";
import { type RefreshScope } from "@/lib/generated/prisma/enums";
import type { GetRefreshCacheInput } from "@/server/schemas/refresh-cache.schema";

type TouchRefreshCacheInput = {
  userId: string;
  tokenPublicKey: string;
  scope: RefreshScope;
  refreshedAt?: Date;
};

export const refreshCacheService = {
  async getByScope(input: GetRefreshCacheInput, userId: string) {
    return await prisma.refreshCache.findUnique({
      where: {
        userId_tokenPublicKey_scope: {
          userId,
          tokenPublicKey: input.tokenPublicKey,
          scope: input.scope,
        },
      },
    });
  },
  async touch(input: TouchRefreshCacheInput) {
    const refreshedAt = input.refreshedAt ?? new Date();
    return await prisma.refreshCache.upsert({
      where: {
        userId_tokenPublicKey_scope: {
          userId: input.userId,
          tokenPublicKey: input.tokenPublicKey,
          scope: input.scope,
        },
      },
      update: {
        lastRefreshedAt: refreshedAt,
      },
      create: {
        userId: input.userId,
        tokenPublicKey: input.tokenPublicKey,
        scope: input.scope,
        lastRefreshedAt: refreshedAt,
      },
    });
  },
};
