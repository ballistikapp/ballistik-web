import { Worker } from "bullmq";
import { getRedisConnection } from "@/lib/queue/connection";
import {
  getVolumeBotControlQueueEvents,
  getVolumeBotControlQueueScheduler,
  getVolumeBotQueueEvents,
  getVolumeBotQueueScheduler,
  volumeBotControlQueueName,
  volumeBotQueueName,
} from "@/lib/queue/volume-bot-queues";
import {
  handleVolumeBotControlJob,
  handleVolumeBotJob,
  registerVolumeBotQueueEvents,
} from "@/server/services/volume-bot-worker";

const connection = getRedisConnection();

getVolumeBotQueueScheduler();
getVolumeBotQueueEvents();
getVolumeBotControlQueueScheduler();
getVolumeBotControlQueueEvents();

registerVolumeBotQueueEvents().catch((error) => {
  throw error;
});

new Worker(volumeBotQueueName, handleVolumeBotJob, { connection });
new Worker(volumeBotControlQueueName, handleVolumeBotControlJob, {
  connection,
});
