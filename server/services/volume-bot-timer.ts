import { prisma } from "@/lib/prisma";
import { mapWithConcurrency } from "@/lib/utils/async";
import {
  processVolumeBotWallet,
  stopVolumeBotSession,
} from "@/server/services/volume-bot-worker";

const MAX_TIMEOUT_MS = 2_147_483_647;
const RECOVERY_CONCURRENCY = 5;

type WalletSchedule = {
  walletId: string;
  sessionId: string;
  nextTickAt: Date;
};

class VolumeBotTimerManager {
  private walletTimers = new Map<string, NodeJS.Timeout>();
  private walletToSession = new Map<string, string>();
  private sessionToWallets = new Map<string, Set<string>>();
  private sessionStopTimers = new Map<string, NodeJS.Timeout>();
  private shuttingDown = false;
  private shutdownRegistered = false;

  async scheduleSession(sessionId: string) {
    const session = await prisma.volumeBotSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, scheduledStopAt: true },
    });
    if (!session || session.status !== "RUNNING") {
      return;
    }

    this.scheduleStopTimer(session.id, session.scheduledStopAt);

    const wallets = await prisma.volumeBotWallet.findMany({
      where: { sessionId: session.id, status: "ACTIVE" },
      select: { id: true, sessionId: true, nextTickAt: true },
    });

    wallets.forEach((wallet) => {
      const nextTickAt = wallet.nextTickAt ?? new Date();
      this.scheduleWallet({
        walletId: wallet.id,
        sessionId: wallet.sessionId,
        nextTickAt,
      });
    });
  }

  scheduleWallet(schedule: WalletSchedule) {
    if (this.shuttingDown) return;
    const { walletId, sessionId, nextTickAt } = schedule;
    this.cancelWallet(walletId);

    const delayMs = Math.max(0, nextTickAt.getTime() - Date.now());
    const safeDelayMs = Math.min(delayMs, MAX_TIMEOUT_MS);

    const timeout = setTimeout(() => {
      void this.handleWalletTick(walletId);
    }, safeDelayMs);

    this.walletTimers.set(walletId, timeout);
    this.walletToSession.set(walletId, sessionId);
    if (!this.sessionToWallets.has(sessionId)) {
      this.sessionToWallets.set(sessionId, new Set());
    }
    this.sessionToWallets.get(sessionId)?.add(walletId);
  }

  cancelWallet(walletId: string) {
    const timer = this.walletTimers.get(walletId);
    if (timer) {
      clearTimeout(timer);
    }
    this.walletTimers.delete(walletId);

    const sessionId = this.walletToSession.get(walletId);
    this.walletToSession.delete(walletId);
    if (sessionId) {
      const walletSet = this.sessionToWallets.get(sessionId);
      walletSet?.delete(walletId);
      if (walletSet && walletSet.size === 0) {
        this.sessionToWallets.delete(sessionId);
      }
    }
  }

  cancelSession(sessionId: string) {
    const walletSet = this.sessionToWallets.get(sessionId);
    if (walletSet) {
      walletSet.forEach((walletId) => this.cancelWallet(walletId));
    }
    this.sessionToWallets.delete(sessionId);
    this.clearStopTimer(sessionId);
  }

  async requestStop(sessionId: string) {
    console.log(`[TimerManager] requestStop called for session ${sessionId}`);
    console.log(`[TimerManager] Current tracked sessions: ${Array.from(this.sessionToWallets.keys()).join(", ") || "none"}`);
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

  async recover() {
    const sessions = await prisma.volumeBotSession.findMany({
      where: { status: "RUNNING" },
      select: { id: true, scheduledStopAt: true },
    });

    sessions.forEach((session) =>
      this.scheduleStopTimer(session.id, session.scheduledStopAt)
    );

    const wallets = await prisma.volumeBotWallet.findMany({
      where: {
        status: "ACTIVE",
        session: { status: "RUNNING" },
      },
      select: { id: true, sessionId: true, nextTickAt: true },
    });

    const now = Date.now();
    const overdue = wallets.filter(
      (wallet) => !wallet.nextTickAt || wallet.nextTickAt.getTime() <= now
    );
    const upcoming = wallets.filter(
      (wallet) => wallet.nextTickAt && wallet.nextTickAt.getTime() > now
    );

    upcoming.forEach((wallet) => {
      this.scheduleWallet({
        walletId: wallet.id,
        sessionId: wallet.sessionId,
        nextTickAt: wallet.nextTickAt as Date,
      });
    });

    if (overdue.length > 0) {
      await mapWithConcurrency(overdue, RECOVERY_CONCURRENCY, async (wallet) => {
        await this.handleWalletTick(wallet.id);
      });
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
    this.walletTimers.forEach((timer) => clearTimeout(timer));
    this.walletTimers.clear();
    this.walletToSession.clear();
    this.sessionToWallets.clear();
    this.sessionStopTimers.forEach((timer) => clearTimeout(timer));
    this.sessionStopTimers.clear();
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

  private async handleWalletTick(walletId: string) {
    this.cancelWallet(walletId);

    const volumeWallet = await prisma.volumeBotWallet.findUnique({
      where: { id: walletId },
      include: { session: true, wallet: true },
    });
    if (!volumeWallet) {
      return;
    }

    const nextTickAt = await processVolumeBotWallet(volumeWallet);
    if (!nextTickAt || volumeWallet.session.status !== "RUNNING") {
      return;
    }

    this.scheduleWallet({
      walletId: volumeWallet.id,
      sessionId: volumeWallet.sessionId,
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
