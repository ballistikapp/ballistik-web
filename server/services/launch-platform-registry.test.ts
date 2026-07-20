import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

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

test("platform registry resolves pump.fun", async () => {
  stubServerOnlyModule();
  const { resolveLaunchPlatform } = await import("./launch-platform-registry");
  const platform = resolveLaunchPlatform("PUMPFUN");
  assert.equal(platform.id, "PUMPFUN");
});

test("platform registry rejects unsupported Platforms before record creation", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const { resolveLaunchPlatform } = await import("./launch-platform-registry");

  assert.throws(
    () => resolveLaunchPlatform("SPL"),
    (error: unknown) =>
      isAppError(error) &&
      error.message.includes("Unsupported launch Platform")
  );
  assert.throws(
    () => resolveLaunchPlatform("EVM"),
    (error: unknown) => isAppError(error)
  );
});
