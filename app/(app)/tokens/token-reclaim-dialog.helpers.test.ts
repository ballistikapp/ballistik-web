import assert from "node:assert/strict";
import test from "node:test";
import { getTotalReclaimableSol } from "./token-reclaim-dialog.helpers";

test("getTotalReclaimableSol sums wallet balances", () => {
  const total = getTotalReclaimableSol([
    { publicKey: "wallet-1", balanceSol: 0.1 },
    { publicKey: "wallet-2", balanceSol: "0.25" },
    { publicKey: "wallet-3", balanceSol: null },
  ]);

  assert.equal(total, 0.35);
});

test("getTotalReclaimableSol ignores invalid balances", () => {
  const total = getTotalReclaimableSol([
    { publicKey: "wallet-1", balanceSol: "bad-input" },
    { publicKey: "wallet-2", balanceSol: undefined },
  ]);

  assert.equal(total, 0);
});
