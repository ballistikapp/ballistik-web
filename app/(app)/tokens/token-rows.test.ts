import assert from "node:assert/strict";
import test from "node:test";
import { mapUserTokenToTableRow } from "./token-rows";

test("mapUserTokenToTableRow maps persisted Token fields only", () => {
  const row = mapUserTokenToTableRow({
    publicKey: "MintABC",
    status: "ACTIVE",
    name: "Alpha",
    symbol: "ALP",
    imageUrl: "https://example.com/a.png",
    websiteUrl: "https://example.com",
    twitterUrl: null,
    telegramUrl: null,
    createdAt: new Date("2026-07-21T12:00:00.000Z"),
    isLegacy: false,
  });

  assert.equal(row.id, "MintABC");
  assert.equal(row.publicKey, "MintABC");
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.name, "Alpha");
  assert.equal(row.symbol, "ALP");
  assert.equal(row.isLegacy, false);
  assert.equal("launchId" in row, false);
  assert.equal("retriedFromLaunchId" in row, false);
});

test("mapUserTokenToTableRow keeps FAILED Token status without inventing Launch fields", () => {
  const row = mapUserTokenToTableRow({
    publicKey: "MintFail",
    status: "FAILED",
    name: "Broken",
    symbol: "BRK",
    imageUrl: null,
    websiteUrl: null,
    twitterUrl: null,
    telegramUrl: null,
    createdAt: new Date("2026-07-21T12:00:00.000Z"),
    isLegacy: true,
  });

  assert.equal(row.status, "FAILED");
  assert.equal(row.isLegacy, true);
  assert.equal(row.publicKey, "MintFail");
});
