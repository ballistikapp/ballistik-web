import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const require = createRequire(import.meta.url);

function stubServerOnlyModule() {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
    children: [],
    path: serverOnlyPath,
    paths: [],
    isPreloading: false,
    parent: undefined,
    require,
  } as unknown as NodeJS.Module;
}

test("deriveHoldingExitTerminalStatus returns FAILED when bundle chunks fail", async () => {
  stubServerOnlyModule();
  const { deriveHoldingExitTerminalStatus } = await import(
    "./holding-exit-status"
  );

  assert.deepEqual(
    deriveHoldingExitTerminalStatus({
      failedChunks: 2,
      cleanupFailedWallets: 0,
    }),
    {
      status: "FAILED",
      errorMessage: "2 chunk(s) failed during bundle submission",
    }
  );
});

test("deriveHoldingExitTerminalStatus returns PARTIAL_SUCCESS for cleanup failures", async () => {
  stubServerOnlyModule();
  const { deriveHoldingExitTerminalStatus } = await import(
    "./holding-exit-status"
  );

  assert.deepEqual(
    deriveHoldingExitTerminalStatus({
      failedChunks: 0,
      cleanupFailedWallets: 3,
    }),
    {
      status: "PARTIAL_SUCCESS",
      errorMessage:
        "3 wallet(s) had cleanup or SOL recovery failures after successful exit",
    }
  );
});

test("deriveHoldingExitTerminalStatus returns SUCCEEDED when exit and cleanup both succeed", async () => {
  stubServerOnlyModule();
  const { deriveHoldingExitTerminalStatus } = await import(
    "./holding-exit-status"
  );

  assert.deepEqual(
    deriveHoldingExitTerminalStatus({
      failedChunks: 0,
      cleanupFailedWallets: 0,
    }),
    {
      status: "SUCCEEDED",
      errorMessage: null,
    }
  );
});
