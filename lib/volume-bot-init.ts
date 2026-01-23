import { volumeBotTimer } from "@/server/services/volume-bot-timer";

const globalForVolumeBotInit = globalThis as unknown as {
  volumeBotInitPromise?: Promise<void>;
};

export const initVolumeBotTimers = async () => {
  if (!globalForVolumeBotInit.volumeBotInitPromise) {
    globalForVolumeBotInit.volumeBotInitPromise = (async () => {
      await volumeBotTimer.recover();
      volumeBotTimer.registerShutdownHandlers();
    })();
  }

  return globalForVolumeBotInit.volumeBotInitPromise;
};
