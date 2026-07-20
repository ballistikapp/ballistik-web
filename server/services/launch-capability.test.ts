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

test("legacy null Platform version denies retry, clone, new buys, and automation", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const {
    assertNonLegacyPlatformCapability,
    legacyCapabilityDeniedMessage,
  } = await import("./launch-capability");

  for (const capability of [
    "retry",
    "clone",
    "new buys",
    "automation",
  ] as const) {
    assert.throws(
      () =>
        assertNonLegacyPlatformCapability(
          { platformVersion: null },
          capability
        ),
      (error: unknown) =>
        isAppError(error) &&
        error.statusCode === 400 &&
        error.message === legacyCapabilityDeniedMessage(capability)
    );
  }
});

test("versioned Platform records are not denied by the legacy capability seam", async () => {
  stubServerOnlyModule();
  const { assertNonLegacyPlatformCapability } = await import(
    "./launch-capability"
  );

  assert.doesNotThrow(() =>
    assertNonLegacyPlatformCapability({ platformVersion: "1" }, "retry")
  );
  assert.doesNotThrow(() =>
    assertNonLegacyPlatformCapability({ platformVersion: "1" }, "clone")
  );
  assert.doesNotThrow(() =>
    assertNonLegacyPlatformCapability({ platformVersion: "1" }, "new buys")
  );
  assert.doesNotThrow(() =>
    assertNonLegacyPlatformCapability({ platformVersion: "1" }, "automation")
  );
});

test("legacy identity does not inspect Launch input JSON shape", async () => {
  stubServerOnlyModule();
  const { isAppError } = await import("@/server/errors");
  const { assertNonLegacyPlatformCapability } = await import(
    "./launch-capability"
  );

  // Versioned-looking input must not override null platformVersion.
  assert.throws(
    () =>
      assertNonLegacyPlatformCapability(
        {
          platformVersion: null,
          input: {
            schemaVersion: 1,
            platform: "PUMPFUN",
          },
        } as { platformVersion: string | null },
        "retry"
      ),
    (error: unknown) => isAppError(error)
  );

  // Flat legacy-looking input must not deny a versioned record.
  assert.doesNotThrow(() =>
    assertNonLegacyPlatformCapability(
      {
        platformVersion: "1",
        input: { tokenName: "legacy-shaped" },
      } as { platformVersion: string | null },
      "retry"
    )
  );
});
