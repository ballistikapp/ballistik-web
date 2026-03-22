import assert from "node:assert/strict";
import test from "node:test";
import { parseInflightBundleStatusesResponse } from "./jito-client";

test("parses inflight bundle statuses response", () => {
  const parsed = parseInflightBundleStatusesResponse({
    jsonrpc: "2.0",
    result: {
      context: {
        slot: 123,
      },
      value: [
        {
          bundle_id: "bundle-1",
          status: "Pending",
          landed_slot: null,
        },
        {
          bundle_id: "bundle-2",
          status: "Landed",
          landed_slot: 456,
        },
      ],
    },
    id: 1,
  });

  assert.equal(parsed.contextSlot, 123);
  assert.deepEqual(parsed.bundles, [
    {
      bundleId: "bundle-1",
      status: "Pending",
      landedSlot: null,
    },
    {
      bundleId: "bundle-2",
      status: "Landed",
      landedSlot: 456,
    },
  ]);
});

test("rejects malformed inflight bundle status responses", () => {
  assert.throws(() => parseInflightBundleStatusesResponse({ result: null }), {
    message: "Invalid inflight bundle status response",
  });
});
