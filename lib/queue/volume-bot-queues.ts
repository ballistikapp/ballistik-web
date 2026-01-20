import { Queue, QueueEvents, QueueScheduler } from "bullmq";
import { getRedisConnection } from "@/lib/queue/connection";

const defaultJobOptions = {
  attempts: 5,
  backoff: {
    type: "exponential" as const,
    delay: 2000,
  },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

let volumeBotQueue: Queue | null = null;
let volumeBotControlQueue: Queue | null = null;
let volumeBotQueueScheduler: QueueScheduler | null = null;
let volumeBotQueueEvents: QueueEvents | null = null;
let volumeBotControlQueueScheduler: QueueScheduler | null = null;
let volumeBotControlQueueEvents: QueueEvents | null = null;

export const volumeBotQueueName = "volumeBot";
export const volumeBotControlQueueName = "volumeBotControl";

export const getVolumeBotQueue = () => {
  if (volumeBotQueue) {
    return volumeBotQueue;
  }
  volumeBotQueue = new Queue(volumeBotQueueName, {
    connection: getRedisConnection(),
    defaultJobOptions,
  });
  return volumeBotQueue;
};

export const getVolumeBotControlQueue = () => {
  if (volumeBotControlQueue) {
    return volumeBotControlQueue;
  }
  volumeBotControlQueue = new Queue(volumeBotControlQueueName, {
    connection: getRedisConnection(),
    defaultJobOptions,
  });
  return volumeBotControlQueue;
};

export const getVolumeBotQueueScheduler = () => {
  if (volumeBotQueueScheduler) {
    return volumeBotQueueScheduler;
  }
  volumeBotQueueScheduler = new QueueScheduler(volumeBotQueueName, {
    connection: getRedisConnection(),
  });
  return volumeBotQueueScheduler;
};

export const getVolumeBotQueueEvents = () => {
  if (volumeBotQueueEvents) {
    return volumeBotQueueEvents;
  }
  volumeBotQueueEvents = new QueueEvents(volumeBotQueueName, {
    connection: getRedisConnection(),
  });
  return volumeBotQueueEvents;
};

export const getVolumeBotControlQueueScheduler = () => {
  if (volumeBotControlQueueScheduler) {
    return volumeBotControlQueueScheduler;
  }
  volumeBotControlQueueScheduler = new QueueScheduler(volumeBotControlQueueName, {
    connection: getRedisConnection(),
  });
  return volumeBotControlQueueScheduler;
};

export const getVolumeBotControlQueueEvents = () => {
  if (volumeBotControlQueueEvents) {
    return volumeBotControlQueueEvents;
  }
  volumeBotControlQueueEvents = new QueueEvents(volumeBotControlQueueName, {
    connection: getRedisConnection(),
  });
  return volumeBotControlQueueEvents;
};
