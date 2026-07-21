import assert from "node:assert/strict";
import test from "node:test";
import {
  FUNNEL_PLATFORM_OPTIONS,
  getAvailableFunnelPlatforms,
  getComingSoonFunnelPlatforms,
  isSubmittableFunnelPlatform,
} from "./platform-availability";

test("funnel exposes pump.fun as the only available Platform", () => {
  const available = getAvailableFunnelPlatforms();
  assert.deepEqual(
    available.map((option) => option.id),
    ["PUMPFUN"]
  );
  assert.equal(available[0]?.available, true);
});

test("funnel shows SPL as coming soon and not submittable", () => {
  const comingSoon = getComingSoonFunnelPlatforms();
  assert.deepEqual(
    comingSoon.map((option) => option.id),
    ["SPL"]
  );
  assert.equal(isSubmittableFunnelPlatform("SPL"), false);
  assert.equal(isSubmittableFunnelPlatform("PUMPFUN"), true);
});

test("funnel Platform options exclude EVM", () => {
  const ids = FUNNEL_PLATFORM_OPTIONS.map((option) => option.id);
  assert.ok(!ids.includes("EVM" as (typeof ids)[number]));
  assert.equal(
    FUNNEL_PLATFORM_OPTIONS.some((option) =>
      option.label.toLowerCase().includes("evm")
    ),
    false
  );
});
