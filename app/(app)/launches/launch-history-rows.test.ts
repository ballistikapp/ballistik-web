import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLaunchLineageLabel,
  mapUserLaunchToHistoryRow,
} from "./launch-history-rows";

test("mapUserLaunchToHistoryRow keeps Launch statuses and pre-mint attempts without Tokens", () => {
  const row = mapUserLaunchToHistoryRow({
    id: "launch-pre-mint",
    status: "FAILED",
    retriedFromLaunchId: null,
    hasRetryAttempts: false,
    tokenPublicKey: null,
    tokenName: "Ghost",
    tokenSymbol: "GST",
    imageUrl: null,
    websiteUrl: null,
    twitterUrl: null,
    telegramUrl: null,
    errorMessage: "Insufficient funds",
    createdAt: new Date("2026-07-21T12:00:00.000Z"),
    isLegacy: false,
  });

  assert.equal(row.id, "launch-pre-mint");
  assert.equal(row.launchId, "launch-pre-mint");
  assert.equal(row.status, "FAILED");
  assert.equal(row.publicKey, null);
  assert.equal(row.name, "Ghost");
  assert.equal(row.symbol, "GST");
  assert.equal(row.retriedFromLaunchId, null);
  assert.equal(row.hasRetryAttempts, false);
  assert.equal(row.isLegacy, false);
});

test("mapUserLaunchToHistoryRow preserves SUCCEEDED and CANCELED without remapping to Token statuses", () => {
  const succeeded = mapUserLaunchToHistoryRow({
    id: "launch-ok",
    status: "SUCCEEDED",
    retriedFromLaunchId: null,
    hasRetryAttempts: true,
    tokenPublicKey: "Mint111",
    tokenName: "Ok",
    tokenSymbol: "OK",
    imageUrl: null,
    websiteUrl: null,
    twitterUrl: null,
    telegramUrl: null,
    errorMessage: null,
    createdAt: new Date("2026-07-21T12:00:00.000Z"),
    isLegacy: false,
  });
  const canceled = mapUserLaunchToHistoryRow({
    id: "launch-cancel",
    status: "CANCELED",
    retriedFromLaunchId: "launch-pre-mint",
    hasRetryAttempts: false,
    tokenPublicKey: null,
    tokenName: "Cancel",
    tokenSymbol: "CXL",
    imageUrl: null,
    websiteUrl: null,
    twitterUrl: null,
    telegramUrl: null,
    errorMessage: null,
    createdAt: new Date("2026-07-21T12:05:00.000Z"),
    isLegacy: false,
  });

  assert.equal(succeeded.status, "SUCCEEDED");
  assert.equal(succeeded.publicKey, "Mint111");
  assert.equal(succeeded.hasRetryAttempts, true);
  assert.equal(canceled.status, "CANCELED");
  assert.equal(canceled.retriedFromLaunchId, "launch-pre-mint");
});

test("formatLaunchLineageLabel describes retry parent and child attempts", () => {
  assert.equal(
    formatLaunchLineageLabel({
      retriedFromLaunchId: null,
      hasRetryAttempts: false,
    }),
    null
  );
  assert.equal(
    formatLaunchLineageLabel({
      retriedFromLaunchId: "abcdefghijklmnop",
      hasRetryAttempts: false,
    }),
    "Retry of abcdefgh…"
  );
  assert.equal(
    formatLaunchLineageLabel({
      retriedFromLaunchId: null,
      hasRetryAttempts: true,
    }),
    "Has retries"
  );
  assert.equal(
    formatLaunchLineageLabel({
      retriedFromLaunchId: "abcdefghijklmnop",
      hasRetryAttempts: true,
    }),
    "Retry of abcdefgh… · Has retries"
  );
});
