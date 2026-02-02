import { PublicKey } from "@solana/web3.js";
import { getVolumeBotConfig } from "@/lib/config/volume-bot.config";
import { prisma } from "@/lib/prisma";
import { getSolanaConnection } from "@/lib/solana/connection";
import { mapWithConcurrency } from "@/lib/utils/async";
import { derivePumpAddresses } from "@/server/solana/pump-new-idl";
import { volumeBotGrpc } from "@/server/solana/volume-bot-grpc";
import type { VolumeBotConfigInput } from "@/server/schemas/volume-bot.schema";
import {
  processVolumeBotWalletRange,
  stopVolumeBotSession,
} from "@/server/services/volume-bot-worker";
import { walletService } from "@/server/services/wallet.service";

const MAX_TIMEOUT_MS = 2_147_483_647;
const RECOVERY_CONCURRENCY = 5;
const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

type WalletRangeSchedule = {
  walletId: string;
  sessionId: string;
  rangeIndex: number;
  nextTickAt: Date;
};

class VolumeBotTimerManager {
  private walletRangeTimers = new Map<string, NodeJS.Timeout>();
  private walletRangeToSession = new Map<string, string>();
  private sessionToWalletRanges = new Map<string, Set<string>>();
  private sessionStopTimers = new Map<string, NodeJS.Timeout>();
  private sessionStartTimers = new Map<string, NodeJS.Timeout>();
  private watchdogTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private shutdownRegistered = false;

  private makeWalletRangeKey(walletId: string, rangeIndex: number): string {
    return `${walletId}:${rangeIndex}`;
  }

  async scheduleSession(sessionId: string) {
    const session = await prisma.volumeBotSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        scheduledStopAt: true,
        scheduledStartAt: true,
        config: true,
      },
    });
    if (!session) {
      return;
    }
    if (session.status === "SCHEDULED") {
      this.scheduleStartTimer(session.id, session.scheduledStartAt);
      return;
    }
    if (session.status !== "RUNNING") {
      return;
    }

    this.scheduleStopTimer(session.id, session.scheduledStopAt);

    const wallets = await prisma.volumeBotWallet.findMany({
      where: { sessionId: session.id, status: "ACTIVE" },
      select: { id: true, sessionId: true },
    });

    const config = session.config as VolumeBotConfigInput;
    wallets.forEach((wallet) => {
      config.ranges.forEach((range, rangeIndex) => {
        const nextTickAt = this.computeNextTickAt(range);
        this.scheduleWalletRange({
          walletId: wallet.id,
          sessionId: wallet.sessionId,
          rangeIndex,
          nextTickAt,
        });
      });
    });
  }

  scheduleWalletRange(schedule: WalletRangeSchedule) {
    if (this.shuttingDown) return;
    const { walletId, sessionId, rangeIndex, nextTickAt } = schedule;
    const key = this.makeWalletRangeKey(walletId, rangeIndex);
    this.cancelWalletRange(key);

    const delayMs = Math.max(0, nextTickAt.getTime() - Date.now());
    const safeDelayMs = Math.min(delayMs, MAX_TIMEOUT_MS);

    const timeout = setTimeout(() => {
      void this.handleWalletRangeTick(walletId, rangeIndex);
    }, safeDelayMs);

    this.walletRangeTimers.set(key, timeout);
    this.walletRangeToSession.set(key, sessionId);
    if (!this.sessionToWalletRanges.has(sessionId)) {
      this.sessionToWalletRanges.set(sessionId, new Set());
    }
    this.sessionToWalletRanges.get(sessionId)?.add(key);
  }

  cancelWalletRange(key: string) {
    const timer = this.walletRangeTimers.get(key);
    if (timer) {
      clearTimeout(timer);
    }
    this.walletRangeTimers.delete(key);

    const sessionId = this.walletRangeToSession.get(key);
    this.walletRangeToSession.delete(key);
    if (sessionId) {
      const keySet = this.sessionToWalletRanges.get(sessionId);
      keySet?.delete(key);
      if (keySet && keySet.size === 0) {
        this.sessionToWalletRanges.delete(sessionId);
      }
    }
  }

  cancelAllWalletRanges(walletId: string) {
    const keysToCancel: string[] = [];
    this.walletRangeTimers.forEach((_, key) => {
      if (key.startsWith(`${walletId}:`)) {
        keysToCancel.push(key);
      }
    });
    keysToCancel.forEach((key) => this.cancelWalletRange(key));
  }

  cancelSession(sessionId: string) {
    const keySet = this.sessionToWalletRanges.get(sessionId);
    if (keySet) {
      keySet.forEach((key) => this.cancelWalletRange(key));
    }
    this.sessionToWalletRanges.delete(sessionId);
    this.clearStopTimer(sessionId);
    this.clearStartTimer(sessionId);
    volumeBotGrpc.unsubscribeFromSession(sessionId);
  }

  async requestStop(sessionId: string) {
    console.log(`[TimerManager] requestStop called for session ${sessionId}`);
    console.log(`[TimerManager] Current tracked sessions: ${Array.from(this.sessionToWalletRanges.keys()).join(", ") || "none"}`);
    this.cancelSession(sessionId);
    try {
      await stopVolumeBotSession(sessionId);
      console.log(`[TimerManager] stopVolumeBotSession completed for ${sessionId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TimerManager] stopVolumeBotSession failed for ${sessionId}: ${message}`);
      await prisma.volumeBotLog.create({
        data: {
          sessionId,
          level: "ERROR",
          type: "stop",
          message,
        },
      });
    }
  }

  private computeNextTickAt(range: VolumeBotConfigInput["ranges"][number]): Date {
    const randomBetween = (min: number, max: number) => Math.random() * (max - min) + min;
    const delaySeconds = Math.floor(randomBetween(range.intervalMin, range.intervalMax));
    return new Date(Date.now() + delaySeconds * 1000);
  }

  async recover() {
    const sessions = await prisma.volumeBotSession.findMany({
      where: { status: { in: ["RUNNING", "SCHEDULED"] } },
      select: {
        id: true,
        status: true,
        scheduledStopAt: true,
        scheduledStartAt: true,
        tokenPublicKey: true,
        config: true,
      },
    });

    const runningSessions = sessions.filter(
      (session) => session.status === "RUNNING"
    );
    const scheduledSessions = sessions.filter(
      (session) => session.status === "SCHEDULED"
    );

    runningSessions.forEach((session) =>
      this.scheduleStopTimer(session.id, session.scheduledStopAt)
    );

    scheduledSessions.forEach((session) =>
      this.scheduleStartTimer(session.id, session.scheduledStartAt)
    );

    if (runningSessions.length > 0) {
      const connected = await volumeBotGrpc.connect();
      if (connected) {
        for (const session of runningSessions) {
          await this.subscribeSessionToGrpc(session.id, session.tokenPublicKey);
        }
      }
    }

    const wallets = await prisma.volumeBotWallet.findMany({
      where: {
        status: "ACTIVE",
        session: { status: "RUNNING" },
      },
      select: { id: true, sessionId: true, session: { select: { config: true } } },
    });

    const walletRangeSchedules: Array<{ walletId: string; rangeIndex: number }> = [];
    wallets.forEach((wallet) => {
      const config = wallet.session.config as VolumeBotConfigInput;
      config.ranges.forEach((_, rangeIndex) => {
        walletRangeSchedules.push({ walletId: wallet.id, rangeIndex });
      });
    });

    if (walletRangeSchedules.length > 0) {
      await mapWithConcurrency(walletRangeSchedules, RECOVERY_CONCURRENCY, async ({ walletId, rangeIndex }) => {
        await this.handleWalletRangeTick(walletId, rangeIndex);
      });
    }

    this.startWatchdog();
  }

  private startWatchdog() {
    if (this.watchdogTimer || this.shuttingDown) return;
    console.log("[TimerManager] Starting orphaned session watchdog");
    this.watchdogTimer = setInterval(() => {
      void this.checkOrphanedSessions();
    }, WATCHDOG_INTERVAL_MS);
  }

  private stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private async checkOrphanedSessions() {
    if (this.shuttingDown) return;

    const config = getVolumeBotConfig();
    const orphanedThreshold = new Date(Date.now() - config.orphanedSessionTimeoutMs);

    const orphanedSessions = await prisma.volumeBotSession.findMany({
      where: {
        status: "RUNNING",
        OR: [
          { lastTickAt: { lt: orphanedThreshold } },
          { lastTickAt: null, startedAt: { lt: orphanedThreshold } },
        ],
      },
      select: { id: true, lastTickAt: true, startedAt: true },
    });

    if (orphanedSessions.length === 0) return;

    console.log(
      `[Watchdog] Found ${orphanedSessions.length} orphaned session(s), stopping...`
    );

    for (const session of orphanedSessions) {
      const lastActivity = session.lastTickAt ?? session.startedAt;
      console.log(
        `[Watchdog] Stopping orphaned session ${session.id} (last activity: ${lastActivity?.toISOString() ?? "never"})`
      );
      await prisma.volumeBotLog.create({
        data: {
          sessionId: session.id,
          level: "WARN",
          type: "watchdog",
          message: `Session auto-stopped by watchdog (no activity for ${Math.round(config.orphanedSessionTimeoutMs / 60000)} minutes)`,
        },
      });
      try {
        await this.requestStop(session.id);
      } catch (error) {
        console.error(
          `[Watchdog] Failed to stop session ${session.id}:`,
          error
        );
      }
    }
  }

  registerShutdownHandlers() {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;

    const shutdown = () => {
      this.shutdown();
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }

  shutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.stopWatchdog();
    this.walletRangeTimers.forEach((timer) => clearTimeout(timer));
    this.walletRangeTimers.clear();
    this.walletRangeToSession.clear();
    this.sessionToWalletRanges.clear();
    this.sessionStopTimers.forEach((timer) => clearTimeout(timer));
    this.sessionStopTimers.clear();
    this.sessionStartTimers.forEach((timer) => clearTimeout(timer));
    this.sessionStartTimers.clear();
  }

  private scheduleStopTimer(sessionId: string, scheduledStopAt: Date | null) {
    if (!scheduledStopAt) return;
    this.clearStopTimer(sessionId);

    const delayMs = Math.max(0, scheduledStopAt.getTime() - Date.now());
    const safeDelayMs = Math.min(delayMs, MAX_TIMEOUT_MS);
    const timeout = setTimeout(() => {
      void this.requestStop(sessionId);
    }, safeDelayMs);

    this.sessionStopTimers.set(sessionId, timeout);
  }

  private clearStopTimer(sessionId: string) {
    const timer = this.sessionStopTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.sessionStopTimers.delete(sessionId);
  }

  private scheduleStartTimer(sessionId: string, scheduledStartAt: Date | null) {
    if (!scheduledStartAt) return;
    this.clearStartTimer(sessionId);

    const delayMs = scheduledStartAt.getTime() - Date.now();
    if (delayMs <= 0) {
      void this.startScheduledSession(sessionId);
      return;
    }

    if (delayMs <= MAX_TIMEOUT_MS) {
      const timeout = setTimeout(() => {
        void this.startScheduledSession(sessionId);
      }, delayMs);
      this.sessionStartTimers.set(sessionId, timeout);
      return;
    }

    const timeout = setTimeout(() => {
      this.scheduleStartTimer(sessionId, scheduledStartAt);
    }, 24 * 60 * 60 * 1000);
    this.sessionStartTimers.set(sessionId, timeout);
  }

  private clearStartTimer(sessionId: string) {
    const timer = this.sessionStartTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.sessionStartTimers.delete(sessionId);
  }

  private async fundSessionWallets(
    sessionId: string,
    tokenPublicKey: string,
    userId: string,
    config: VolumeBotConfigInput
  ) {
    const selectedWalletPublicKeys = Array.from(
      new Set(config.walletConfig.selectedWalletPublicKeys ?? [])
    );
    const sessionWallets = await prisma.volumeBotWallet.findMany({
      where: { sessionId },
      select: { walletPublicKey: true },
    });
    const selectedSet = new Set(selectedWalletPublicKeys);
    const generatedWalletPublicKeys = sessionWallets
      .map((wallet) => wallet.walletPublicKey)
      .filter((walletPublicKey) => !selectedSet.has(walletPublicKey));

    if (generatedWalletPublicKeys.length > 0) {
      const amount = Math.max(config.walletConfig.fundingPerGeneratedWallet, 0);
      console.log(
        `[TimerManager] Funding ${generatedWalletPublicKeys.length} generated wallets with ${amount} SOL`
      );
      await walletService.sendSolFromMainWallet(
        tokenPublicKey,
        userId,
        generatedWalletPublicKeys,
        amount
      );
    }

    if (selectedWalletPublicKeys.length > 0) {
      const connection = getSolanaConnection();
      await Promise.all(
        selectedWalletPublicKeys.map(async (walletPublicKey) => {
          const balanceLamports = await connection.getBalance(
            new PublicKey(walletPublicKey)
          );
          const balanceSol = balanceLamports / 1_000_000_000;
          if (balanceSol >= config.walletConfig.topUpAmount) {
            console.log(
              `[TimerManager] Wallet ${walletPublicKey} has sufficient balance (${balanceSol} SOL)`
            );
            return;
          }
          const topUpSol = config.walletConfig.topUpAmount - balanceSol;
          if (topUpSol <= 0) {
            return;
          }
          console.log(
            `[TimerManager] Topping up wallet ${walletPublicKey} by ${topUpSol} SOL`
          );
          await walletService.sendSolFromMainWallet(
            tokenPublicKey,
            userId,
            [walletPublicKey],
            topUpSol
          );
        })
      );
    }
  }

  private async startScheduledSession(sessionId: string) {
    this.clearStartTimer(sessionId);
    const session = await prisma.volumeBotSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        config: true,
        tokenPublicKey: true,
        userId: true,
      },
    });
    if (!session || session.status !== "SCHEDULED") {
      return;
    }
    const now = new Date();
    await prisma.volumeBotSession.update({
      where: { id: session.id },
      data: { status: "RUNNING", startedAt: now },
    });
    try {
      const config = session.config as VolumeBotConfigInput;
      await this.fundSessionWallets(
        session.id,
        session.tokenPublicKey,
        session.userId,
        config
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.volumeBotLog.create({
        data: {
          sessionId: session.id,
          level: "ERROR",
          type: "start",
          message,
        },
      });
      await prisma.volumeBotSession.update({
        where: { id: session.id },
        data: { status: "FAILED", stoppedAt: new Date() },
      });
      return;
    }

    await this.subscribeSessionToGrpc(session.id, session.tokenPublicKey);
    await this.scheduleSession(session.id);
  }

  private async subscribeSessionToGrpc(
    sessionId: string,
    tokenPublicKey: string
  ) {
    try {
      if (!volumeBotGrpc.isConnected()) {
        const connected = await volumeBotGrpc.connect();
        if (!connected) {
          console.log(
            `[TimerManager] gRPC not available for session ${sessionId}, using RPC fallback`
          );
          return;
        }
      }

      const sessionWallets = await prisma.volumeBotWallet.findMany({
        where: { sessionId, status: "ACTIVE" },
        select: { walletPublicKey: true },
      });

      const walletPubkeys = sessionWallets.map((w) => w.walletPublicKey);
      const mintPubkey = new PublicKey(tokenPublicKey);
      const { bondingCurve } = derivePumpAddresses(mintPubkey);

      await volumeBotGrpc.subscribeToSession(
        sessionId,
        walletPubkeys,
        tokenPublicKey,
        bondingCurve.toBase58()
      );

      console.log(
        `[TimerManager] Subscribed session ${sessionId} to gRPC with ${walletPubkeys.length} wallets`
      );
    } catch (error) {
      console.error(
        `[TimerManager] Failed to subscribe session ${sessionId} to gRPC:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async handleWalletRangeTick(walletId: string, rangeIndex: number) {
    const key = this.makeWalletRangeKey(walletId, rangeIndex);
    this.cancelWalletRange(key);

    const volumeWallet = await prisma.volumeBotWallet.findUnique({
      where: { id: walletId },
      include: { session: true, wallet: true },
    });
    if (!volumeWallet) {
      return;
    }

    const config = volumeWallet.session.config as VolumeBotConfigInput;
    const range = config.ranges[rangeIndex];
    if (!range) {
      return;
    }

    const nextTickAt = await processVolumeBotWalletRange(volumeWallet, rangeIndex);
    if (!nextTickAt || volumeWallet.session.status !== "RUNNING") {
      return;
    }

    this.scheduleWalletRange({
      walletId: volumeWallet.id,
      sessionId: volumeWallet.sessionId,
      rangeIndex,
      nextTickAt,
    });
  }
}

const globalForVolumeBotTimer = globalThis as unknown as {
  volumeBotTimer?: VolumeBotTimerManager;
};

export const volumeBotTimer =
  globalForVolumeBotTimer.volumeBotTimer ?? new VolumeBotTimerManager();

if (process.env.NODE_ENV !== "production") {
  globalForVolumeBotTimer.volumeBotTimer = volumeBotTimer;
}
