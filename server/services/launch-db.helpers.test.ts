import assert from "node:assert/strict";
import test from "node:test";
import {
  isRetryableLaunchDbError,
  retryLaunchDbWrite,
} from "./launch-db.helpers";

test("isRetryableLaunchDbError matches known Prisma timeout codes", () => {
  assert.equal(
    isRetryableLaunchDbError({ code: "P2024", message: "pool timeout" }),
    true
  );
  assert.equal(
    isRetryableLaunchDbError({ code: "P1008", message: "Operation has timed out" }),
    true
  );
});

test("isRetryableLaunchDbError matches timeout messages without Prisma code", () => {
  assert.equal(
    isRetryableLaunchDbError(new Error("Operation has timed out")),
    true
  );
  assert.equal(
    isRetryableLaunchDbError(
      new Error("Timed out fetching a new connection from the connection pool")
    ),
    true
  );
});

test("isRetryableLaunchDbError rejects unrelated errors", () => {
  assert.equal(
    isRetryableLaunchDbError(new Error("Unique constraint failed")),
    false
  );
});

test("retryLaunchDbWrite retries transient launch db errors", async () => {
  let attempts = 0;
  const delays: number[] = [];

  const result = await retryLaunchDbWrite(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("Operation has timed out");
      }
      return "ok";
    },
    {
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("retryLaunchDbWrite does not retry non-retryable errors", async () => {
  let attempts = 0;

  await assert.rejects(
    () =>
      retryLaunchDbWrite(
        async () => {
          attempts += 1;
          throw new Error("Unique constraint failed");
        },
        {
          sleep: async () => {},
        }
      ),
    /Unique constraint failed/
  );

  assert.equal(attempts, 1);
});
