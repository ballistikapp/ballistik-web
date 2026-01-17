import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";

export const walletService = {
  async getWalletsByToken(tokenPublicKey: string, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey: tokenPublicKey, userId },
      include: {
        wallets: {
          select: {
            publicKey: true,
            type: true,
            balanceSol: true,
            balanceRefreshedAt: true,
            isImported: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    return token.wallets;
  },
};

export type WalletsByTokenOutput = Awaited<
  ReturnType<typeof walletService.getWalletsByToken>
>;

export type WalletItem = WalletsByTokenOutput[number];
