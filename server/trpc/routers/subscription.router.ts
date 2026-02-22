import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import {
  grpcManager,
  type AccountUpdate,
  type TransactionUpdate,
} from "@/server/solana/grpc-manager";
import { derivePumpAddresses } from "@/server/solana/pump-new-idl";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { prisma } from "@/lib/prisma";
import {
  dashboardEvents,
  type TradeCompleteEvent,
  type IngestionCompleteEvent,
} from "@/server/events/dashboard-events";
import { invalidateStatsCache } from "@/server/services/dashboard.service";
import { ingestionQueue } from "@/server/services/ingestion-queue.service";
import { transactionService } from "@/server/services/transaction.service";
import { logger } from "@/lib/logger";
import { getEnv } from "@/lib/config/env";

const log = logger.child({ service: "subscription" });
const { MONITORING_PIPELINE_V2: monitoringPipelineV2Enabled } = getEnv();

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

async function getMonitoredWalletPubkeys(
  tokenPublicKey: string,
  userId: string,
  walletPublicKeys?: string[]
): Promise<Set<string>> {
  const [operationalWallets, devWallets, user] = await Promise.all([
    prisma.wallet.findMany({
      where: { tokenPublicKey },
      select: { publicKey: true },
    }),
    prisma.tokenDevWallet.findMany({
      where: { tokenPublicKey },
      select: { walletPublicKey: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { mainWallet: { select: { publicKey: true } } },
    }),
  ]);

  const allPubkeys = new Set<string>();
  for (const wallet of operationalWallets) allPubkeys.add(wallet.publicKey);
  for (const wallet of devWallets) allPubkeys.add(wallet.walletPublicKey);
  if (user?.mainWallet?.publicKey) allPubkeys.add(user.mainWallet.publicKey);

  if (!walletPublicKeys?.length) return allPubkeys;

  const filtered = new Set<string>();
  for (const publicKey of walletPublicKeys) {
    if (allPubkeys.has(publicKey)) filtered.add(publicKey);
  }
  return filtered;
}

export const subscriptionRouter = router({
  onBalanceUpdate: protectedProcedure
    .input(
      z.object({
        tokenPublicKey: z.string().min(1),
        walletPublicKeys: z.array(z.string()).optional(),
      })
    )
    .subscription(async function* ({ input, ctx }) {
      const allPubkeys = await getMonitoredWalletPubkeys(
        input.tokenPublicKey,
        ctx.user.id,
        input.walletPublicKeys
      );

      if (allPubkeys.size === 0) return;

      const subscriptionId = `walletBalance:${ctx.user.id}:${input.tokenPublicKey}`;
      const subscribed = await grpcManager.subscribe(
        subscriptionId,
        Array.from(allPubkeys)
      );
      if (!subscribed) {
        log.warn("gRPC subscribe failed for onBalanceUpdate, SSE will be idle", {
          tokenPublicKey: input.tokenPublicKey,
        });
        if (monitoringPipelineV2Enabled) {
          throw new Error("gRPC wallet balance subscription unavailable");
        }
      }

      const queue: BalanceUpdateEvent[] = [];
      let resolve: (() => void) | null = null;

      const removeListener = grpcManager.onAccountUpdate(
        (update: AccountUpdate) => {
          if (!allPubkeys.has(update.pubkey)) return;
          const balanceSol = update.lamports / 1_000_000_000;
          queue.push({
            pubkey: update.pubkey,
            balanceSol,
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
            const event = queue.shift()!;
            if (!monitoringPipelineV2Enabled) {
              prisma.wallet
                .updateMany({
                  where: { publicKey: event.pubkey },
                  data: {
                    balanceSol: event.balanceSol,
                    balanceRefreshedAt: new Date(),
                  },
                })
                .catch(() => {});
              invalidateStatsCache(input.tokenPublicKey);
              yield event;
              continue;
            }
            try {
              await prisma.wallet.updateMany({
                where: { publicKey: event.pubkey },
                data: {
                  balanceSol: event.balanceSol,
                  balanceRefreshedAt: new Date(),
                },
              });
              grpcManager.reportDbWriteSuccess();
              invalidateStatsCache(input.tokenPublicKey);
            } catch (error) {
              grpcManager.reportDbWriteFailure();
              log.error("Failed to persist wallet balance update", {
                tokenPublicKey: input.tokenPublicKey,
                walletPublicKey: event.pubkey,
                error: error instanceof Error ? error.message : String(error),
              });
              continue;
            }
            yield event;
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
      const walletPubkeys = await getMonitoredWalletPubkeys(
        input.tokenPublicKey,
        ctx.user.id,
        input.walletPublicKeys
      );
      if (walletPubkeys.size === 0) return;

      const tokenMeta = await prisma.token.findUnique({
        where: { publicKey: input.tokenPublicKey },
        select: { name: true, symbol: true, imageUrl: true },
      });

      const monitoredPubkeys = new Set<string>();
      const ataToOwner = new Map<string, string>();
      for (const walletPublicKey of walletPubkeys) {
        monitoredPubkeys.add(walletPublicKey);
        try {
          const ata = getAssociatedTokenAddressSync(
            new PublicKey(input.tokenPublicKey),
            new PublicKey(walletPublicKey)
          );
          const ataPubkey = ata.toBase58();
          monitoredPubkeys.add(ataPubkey);
          ataToOwner.set(ataPubkey, walletPublicKey);
        } catch (error) {
          log.warn("Failed to derive ATA for monitoring", {
            tokenPublicKey: input.tokenPublicKey,
            walletPublicKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const subscriptionId = `tokenBalance:${ctx.user.id}:${input.tokenPublicKey}`;
      const subscribed = await grpcManager.subscribe(
        subscriptionId,
        Array.from(
          monitoringPipelineV2Enabled ? monitoredPubkeys : walletPubkeys
        )
      );
      if (!subscribed) {
        log.warn("gRPC subscribe failed for onTokenBalanceUpdate, SSE will be idle", {
          tokenPublicKey: input.tokenPublicKey,
        });
        if (monitoringPipelineV2Enabled) {
          throw new Error("gRPC token balance subscription unavailable");
        }
      }

      const queue: TokenBalanceUpdateEvent[] = [];
      let resolve: (() => void) | null = null;

      const removeListener = grpcManager.onAccountUpdate(
        (update: AccountUpdate) => {
          if (!update.owner || !update.mint || update.tokenAmount === undefined)
            return;
          const ownerOrAccountMatched =
            walletPubkeys.has(update.owner) || monitoredPubkeys.has(update.pubkey);
          if (!ownerOrAccountMatched) return;
          if (update.mint !== input.tokenPublicKey) return;
          const walletPublicKey = walletPubkeys.has(update.owner)
            ? update.owner
            : ataToOwner.get(update.pubkey) ?? update.owner;
          queue.push({
            walletPublicKey,
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
            const event = queue.shift()!;
            const tokenBalance = Number(event.amount);
            if (!Number.isFinite(tokenBalance)) {
              log.warn("Skipping non-finite token balance update", {
                tokenPublicKey: input.tokenPublicKey,
                walletPublicKey: event.walletPublicKey,
                amount: event.amount,
              });
              continue;
            }
            if (!monitoringPipelineV2Enabled) {
              prisma.holding
                .updateMany({
                  where: {
                    walletPublicKey: event.walletPublicKey,
                    tokenPublicKey: event.mint,
                  },
                  data: { tokenBalance },
                })
                .catch(() => {});
              invalidateStatsCache(input.tokenPublicKey);
              yield event;
              continue;
            }
            try {
              const now = new Date();
              const updated = await prisma.holding.updateMany({
                where: {
                  walletPublicKey: event.walletPublicKey,
                  tokenPublicKey: event.mint,
                },
                data: { tokenBalance, lastUpdated: now },
              });

              if (updated.count === 0) {
                await prisma.holding.create({
                  data: {
                    walletPublicKey: event.walletPublicKey,
                    tokenPublicKey: event.mint,
                    tokenBalance,
                    totalBuyAmount: 0,
                    totalSellAmount: 0,
                    averageBuyPrice: 0,
                    lastTransactionSignature: "",
                    lastUpdated: now,
                    mintAddress: event.mint,
                    tokenName: tokenMeta?.name ?? "",
                    tokenSymbol: tokenMeta?.symbol ?? "",
                    tokenImageUrl: tokenMeta?.imageUrl ?? "",
                    tokenDecimals: 9,
                  },
                });
              }

              grpcManager.reportDbWriteSuccess();
              invalidateStatsCache(input.tokenPublicKey);
            } catch (error) {
              grpcManager.reportDbWriteFailure();
              log.error("Failed to persist token balance update", {
                tokenPublicKey: input.tokenPublicKey,
                walletPublicKey: event.walletPublicKey,
                error: error instanceof Error ? error.message : String(error),
              });
              continue;
            }
            yield event;
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
      const subscribed = await grpcManager.subscribe(subscriptionId, monitoredAccounts);
      if (!subscribed) {
        log.warn("gRPC subscribe failed for onNewTransaction, SSE will be idle", {
          tokenPublicKey: input.tokenPublicKey,
        });
        if (monitoringPipelineV2Enabled) {
          throw new Error("gRPC transaction subscription unavailable");
        }
      }

      const monitoredSet = new Set(monitoredAccounts);
      const queue: NewTransactionEvent[] = [];
      let resolve: (() => void) | null = null;

      const removeListener = grpcManager.onTransactionUpdate(
        (update: TransactionUpdate) => {
          const isRelevantByKeys = update.accountKeys.some((key) =>
            monitoredSet.has(key)
          );
          const isRelevant = isRelevantByKeys || update.accountKeys.length === 0;
          if (!isRelevant) return;
          queue.push({
            signature: update.signature,
            accountKeys: update.accountKeys,
            slot: update.slot,
            detectedAt: Date.now(),
          });
          resolve?.();

          ingestionQueue.enqueue(input.tokenPublicKey, update.signature);
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

  onVolumeBotUpdate: protectedProcedure
    .input(
      z.object({
        tokenPublicKey: z.string().min(1),
      })
    )
    .subscription(async function* ({ input }) {
      const queue: TradeCompleteEvent[] = [];
      let resolve: (() => void) | null = null;

      const removeListener = dashboardEvents.onTradeComplete(
        (event: TradeCompleteEvent) => {
          if (event.tokenPublicKey !== input.tokenPublicKey) return;
          queue.push(event);
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
            const event = queue.shift()!;
            if (event.signature) {
              try {
                await transactionService.ingestTokenSignatures({
                  tokenPublicKey: input.tokenPublicKey,
                  signatures: [event.signature],
                });
                invalidateStatsCache(input.tokenPublicKey);
              } catch (error) {
                log.warn("Failed to ingest trade signature inline", {
                  tokenPublicKey: input.tokenPublicKey,
                  signature: event.signature,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
            yield event;
          }
        }
      } finally {
        removeListener();
      }
    }),

  onIngestionComplete: protectedProcedure
    .input(
      z.object({
        tokenPublicKey: z.string().min(1),
      })
    )
    .subscription(async function* ({ input }) {
      const queue: IngestionCompleteEvent[] = [];
      let resolve: (() => void) | null = null;

      const removeListener = dashboardEvents.onIngestionComplete(
        (event: IngestionCompleteEvent) => {
          if (event.tokenPublicKey !== input.tokenPublicKey) return;
          queue.push(event);
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
      }
    }),
});
