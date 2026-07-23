import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLaunchActivityItems,
  getLaunchFailureGuidance,
} from "./launch-progress-dialog.helpers";

test("buildLaunchActivityItems shows newest entries first and marks the newest row", () => {
  const items = buildLaunchActivityItems([
    {
      id: "older-step",
      level: "STEP",
      message: "Funding wallets",
      step: "funding",
      createdAt: new Date("2026-03-21T10:00:00.000Z"),
    },
    {
      id: "newest-error",
      level: "ERROR",
      message: "Automatic reclaim failed",
      step: "reclaim",
      createdAt: new Date("2026-03-21T10:01:00.000Z"),
    },
  ]);

  assert.equal(items.length, 2);
  assert.equal(items[0]?.id, "newest-error");
  assert.equal(items[0]?.isLatest, true);
  assert.equal(items[0]?.tone, "error");
  assert.equal(items[1]?.id, "older-step");
  assert.equal(items[1]?.isLatest, false);
  assert.equal(items[1]?.tone, "default");
});

test("getLaunchFailureGuidance hides manual reclaim guidance after successful auto reclaim", () => {
  const guidance = getLaunchFailureGuidance({
    status: "FAILED",
    result: {
      failureRecovery: {
        attempted: true,
        manualActionRequired: false,
        recoveredWalletCount: 3,
        totalReturnedSol: 1.2345,
      },
    },
  });

  assert.equal(guidance.showLaunchHistoryAction, false);
  assert.equal(guidance.description, null);
  assert.equal(guidance.href, "/launches");
});

test("getLaunchFailureGuidance shows Launch history guidance when auto reclaim needs manual follow-up", () => {
  const guidance = getLaunchFailureGuidance({
    status: "FAILED",
    result: {
      failureRecovery: {
        attempted: true,
        manualActionRequired: true,
        recoveredWalletCount: 1,
        failedWalletCount: 2,
      },
    },
  });

  assert.equal(guidance.showLaunchHistoryAction, true);
  assert.equal(guidance.href, "/launches");
  assert.match(guidance.description ?? "", /Launch history/i);
});

test("getLaunchFailureGuidance falls back to Launch history guidance for failed launches without recovery metadata", () => {
  const guidance = getLaunchFailureGuidance({
    status: "FAILED",
    result: null,
  });

  assert.equal(guidance.showLaunchHistoryAction, true);
  assert.equal(guidance.href, "/launches");
  assert.match(guidance.description ?? "", /Launch history/i);
});
