import { z } from "zod";
import { observable } from "@trpc/server/observable";
import { router, protectedProcedure } from "../trpc";
import {
  grpcManager,
  type AccountUpdate,
  type TransactionUpdate,
} from "@/server/solana/grpc-manager";
import { derivePumpAddresses } from "@/server/solana/pump-new-idl";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";

type BalanceUpdateEvent = {
  pubkey: string;
  balanceSol: number;
  slot: number;
};

type TokenBalanceUpdateEvent = {
  walletPublicKey: string;
  mint: string;
  amount: string;
  slot: number;
};

type NewTransactionEvent = {
  signature: string;
  accountKeys: string[];
  slot: number;
  detectedAt: number;
};

export const subscriptionRouter = router({
  onBalanceUpdate: protectedProcedure
    .input(
      z.object({
        tokenPublicKey: z.string().min(1),
        walletPublicKeys: z.array(z.string()).optional(),
      })
    )
    .subscription(async function* ({ input, ctx }) {
      const wallets = await prisma.wallet.findMany({
        where: {
          tokenPublicKey: input.tokenPublicKey,
          ...(input.walletPublicKeys?.length
            ? { publicKey: { in: input.walletPublicKeys } }
            : {}),
        },
        select: { publicKey: true },
      });

      const user = await prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { mainWallet: { select: { publicKey: true } } },
      });

      const allPubkeys = new Set(wallets.map((w) => w.publicKey));
      if (user?.mainWallet) {
        allPubkeys.add(user.mainWallet.publicKey);
      }

      if (allPubkeys.size === 0) return;

      const subscriptionId = `walletBalance:${ctx.user.id}:${input.tokenPublicKey}`;
      await grpcManager.subscribe(
        subscriptionId,
        Array.from(allPubkeys)
      );

      const queue: BalanceUpdateEvent[] = [];
      let resolve: (() => void) | null = null;

      const removeListener = grpcManager.onAccountUpdate(
        (update: AccountUpdate) => {
          if (!allPubkeys.has(update.pubkey)) return;
          queue.push({
            pubkey: update.pubkey,
            balanceSol: update.lamports / 1_000_000_000,
            slot: update.slot,
          });
          resolve?.();
        }
      );

      try {
        while (true) {
          if (queue.length === 0) {
            await new Promise<void>((r) => {
              resolve = r;
            });
          }
          while (queue.length > 0) {
            yield queue.shift()!;
          }
        }
      } finally {
        removeListener();
        grpcManager.unsubscribe(subscriptionId);
      }
    }),

  onTokenBalanceUpdate: protectedProcedure
    .input(
      z.object({
        tokenPublicKey: z.string().min(1),
        walletPublicKeys: z.array(z.string()).optional(),
      })
    )
    .subscription(async function* ({ input, ctx }) {
      const wallets = await prisma.wallet.findMany({
        where: {
          tokenPublicKey: input.tokenPublicKey,
          ...(input.walletPublicKeys?.length
            ? { publicKey: { in: input.walletPublicKeys } }
            : {}),
        },
        select: { publicKey: true },
      });

      const allPubkeys = new Set(wallets.map((w) => w.publicKey));
      if (allPubkeys.size === 0) return;

      const subscriptionId = `tokenBalance:${ctx.user.id}:${input.tokenPublicKey}`;
      await grpcManager.subscribe(
        subscriptionId,
        Array.from(allPubkeys)
      );

      const queue: TokenBalanceUpdateEvent[] = [];
      let resolve: (() => void) | null = null;

      const removeListener = grpcManager.onAccountUpdate(
        (update: AccountUpdate) => {
          if (!update.owner || !update.mint || update.tokenAmount === undefined)
            return;
          if (!allPubkeys.has(update.owner)) return;
          if (update.mint !== input.tokenPublicKey) return;
          queue.push({
            walletPublicKey: update.owner,
            mint: update.mint,
            amount: update.tokenAmount.toString(),
            slot: update.slot,
          });
          resolve?.();
        }
      );

      try {
        while (true) {
          if (queue.length === 0) {
            await new Promise<void>((r) => {
              resolve = r;
            });
          }
          while (queue.length > 0) {
            yield queue.shift()!;
          }
        }
      } finally {
        removeListener();
        grpcManager.unsubscribe(subscriptionId);
      }
    }),

  onNewTransaction: protectedProcedure
    .input(
      z.object({
        tokenPublicKey: z.string().min(1),
      })
    )
    .subscription(async function* ({ input, ctx }) {
      const mint = new PublicKey(input.tokenPublicKey);
      const { bondingCurve } = derivePumpAddresses(mint);

      const monitoredAccounts = [
        input.tokenPublicKey,
        bondingCurve.toBase58(),
      ];

      const subscriptionId = `newTx:${ctx.user.id}:${input.tokenPublicKey}`;
      await grpcManager.subscribe(subscriptionId, monitoredAccounts);

      const monitoredSet = new Set(monitoredAccounts);
      const queue: NewTransactionEvent[] = [];
      let resolve: (() => void) | null = null;

      const removeListener = grpcManager.onTransactionUpdate(
        (update: TransactionUpdate) => {
          const isRelevant = update.accountKeys.some((key) =>
            monitoredSet.has(key)
          );
          if (!isRelevant) return;
          queue.push({
            signature: update.signature,
            accountKeys: update.accountKeys,
            slot: update.slot,
            detectedAt: Date.now(),
          });
          resolve?.();
        }
      );

      try {
        while (true) {
          if (queue.length === 0) {
            await new Promise<void>((r) => {
              resolve = r;
            });
          }
          while (queue.length > 0) {
            yield queue.shift()!;
          }
        }
      } finally {
        removeListener();
        grpcManager.unsubscribe(subscriptionId);
      }
    }),
});
