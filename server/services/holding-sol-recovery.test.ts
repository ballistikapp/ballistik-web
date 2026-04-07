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

test("resolveReturnSolToMainWallet forces return when a system dev wallet is present", async () => {
  stubServerOnlyModule();
  const { resolveReturnSolToMainWallet } = await import(
    "./holding-sol-recovery"
  );

  assert.equal(
    resolveReturnSolToMainWallet(
      [
        { isSystemWallet: false },
        { isSystemWallet: true },
      ],
      false
    ),
    true
  );
});

test("resolveReturnSolToMainWallet respects the user toggle for normal wallets", async () => {
  stubServerOnlyModule();
  const { resolveReturnSolToMainWallet } = await import(
    "./holding-sol-recovery"
  );

  assert.equal(
    resolveReturnSolToMainWallet(
      [
        { isSystemWallet: false },
        { isSystemWallet: false },
      ],
      false
    ),
    false
  );
  assert.equal(
    resolveReturnSolToMainWallet(
      [
        { isSystemWallet: false },
        { isSystemWallet: false },
      ],
      true
    ),
    true
  );
});
