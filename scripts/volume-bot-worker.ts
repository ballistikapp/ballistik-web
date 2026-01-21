import { config } from "dotenv";

config({ path: ".env.development" });
config({ path: ".env.development.local" });

const parseNumberEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const main = async () => {
  console.log("[VolumeBot] Worker starting...");

  const { prisma } = await import("@/lib/prisma");
  const { processVolumeBotWallet, stopVolumeBotSession } = await import(
    "@/server/services/volume-bot-worker"
  );

  const pollIntervalMs = parseNumberEnv(
    process.env.VOLUME_BOT_POLL_INTERVAL_MS,
    5000
  );
  const tickBatchSize = parseNumberEnv(
    process.env.VOLUME_BOT_TICK_BATCH_SIZE,
    50
  );

  console.log("[VolumeBot] Config:", { pollIntervalMs, tickBatchSize });

  const runTickBatch = async () => {
    const now = new Date();

    const runningSessions = await prisma.volumeBotSession.findMany({
      where: { status: "RUNNING" },
      select: { id: true, tokenPublicKey: true, status: true },
    });
    console.log(
      `[VolumeBot] Running sessions: ${runningSessions.length}`,
      runningSessions.map((s) => ({ id: s.id, token: s.tokenPublicKey.slice(0, 8) }))
    );

    const activeWallets = await prisma.volumeBotWallet.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, sessionId: true, nextTickAt: true },
    });
    console.log(
      `[VolumeBot] Active wallets: ${activeWallets.length}`,
      activeWallets.map((w) => ({
        id: w.id,
        sessionId: w.sessionId,
        nextTickAt: w.nextTickAt?.toISOString(),
      }))
    );

    const dueWallets = await prisma.volumeBotWallet.findMany({
      where: {
        status: "ACTIVE",
        session: { status: "RUNNING" },
        OR: [{ nextTickAt: { lte: now } }, { nextTickAt: null }],
      },
      include: { session: true, wallet: true },
      orderBy: { nextTickAt: "asc" },
      take: tickBatchSize,
    });

    console.log(
      `[VolumeBot] Due wallets: ${dueWallets.length}`,
      dueWallets.map((w) => ({
        id: w.id,
        walletPk: w.walletPublicKey.slice(0, 8),
        sessionStatus: w.session.status,
        nextTickAt: w.nextTickAt?.toISOString(),
      }))
    );

    if (dueWallets.length > 0) {
      console.log(`[VolumeBot] Processing ${dueWallets.length} wallets...`);
      await Promise.all(
        dueWallets.map((wallet) => processVolumeBotWallet(wallet))
      );
      console.log("[VolumeBot] Done processing wallets");
    }

    const scheduledStops = await prisma.volumeBotSession.findMany({
      where: {
        status: "RUNNING",
        scheduledStopAt: { lte: now },
      },
      select: { id: true },
    });

    if (scheduledStops.length > 0) {
      console.log(`[VolumeBot] Scheduled stops: ${scheduledStops.length}`);
      await prisma.volumeBotSession.updateMany({
        where: { id: { in: scheduledStops.map((session) => session.id) } },
        data: { status: "STOP_REQUESTED", stopRequestedAt: now },
      });
    }

    const stopRequests = await prisma.volumeBotSession.findMany({
      where: { status: "STOP_REQUESTED" },
      select: { id: true },
    });

    if (stopRequests.length > 0) {
      console.log(`[VolumeBot] Stop requests: ${stopRequests.length}`);
    }

    for (const session of stopRequests) {
      console.log(`[VolumeBot] Stopping session ${session.id}`);
      await stopVolumeBotSession(session.id);
    }
  };

  console.log("[VolumeBot] Starting poll loop...");
  let tickCount = 0;
  for (;;) {
    tickCount++;
    console.log(`\n[VolumeBot] === Tick #${tickCount} at ${new Date().toISOString()} ===`);
    try {
      await runTickBatch();
    } catch (error) {
      console.error("[VolumeBot] Worker error:", error);
      if (error instanceof Error && error.cause) {
        console.error("[VolumeBot] Cause:", error.cause);
      }
    }
    await sleep(pollIntervalMs);
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Volume bot worker failed to start:", message);
  process.exit(1);
});
