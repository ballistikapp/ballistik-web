import assert from "node:assert/strict";
import test from "node:test";
import { computeRecoverableLamports } from "./sol-recovery.ts";

test("leaves the rent reserve in the source wallet", () => {
  const recoverableLamports = computeRecoverableLamports({
    balanceLamports: 1_500_000,
    feeLamports: 5_000,
    rentExemptMinimumLamports: 890_880,
  });

  assert.equal(recoverableLamports, 604_120);
});

test("returns zero when the wallet only has rent reserve and fees", () => {
  const recoverableLamports = computeRecoverableLamports({
    balanceLamports: 895_880,
    feeLamports: 5_000,
    rentExemptMinimumLamports: 890_880,
  });

  assert.equal(recoverableLamports, 0);
});
