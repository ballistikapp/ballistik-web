import IORedis from "ioredis";

let cachedRedis: IORedis | null = null;

export const getRedisConnection = () => {
  if (cachedRedis) {
    return cachedRedis;
  }
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is not set");
  }
  cachedRedis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  return cachedRedis;
};
