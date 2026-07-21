import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { PUMPFUN_PLAN_SCHEMA_VERSION_V1 } from "@/server/schemas/launch-platform.schema";

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

test("assemblePumpfunLaunchPlan builds a secret-free versioned plan", async () => {
  stubServerOnlyModule();
  const {
    assemblePumpfunLaunchPlan,
    planPayloadContainsSecretMaterial,
  } = await import("./launch-platform-pumpfun-plan");

  const plan = assemblePumpfunLaunchPlan({
    money: {
      immediateRequiredBalanceLamports: "1500000000",
      temporaryFundingLamports: "1000000000",
      permanentSpendLamports: "500000000",
      expectedReturnLamports: "1000000000",
      expectedMainWalletDeltaNowLamports: "-1500000000",
      expectedMainWalletDeltaAfterCleanupLamports: "-500000000",
      usageFeeLamports: "0",
      lineItems: [{ label: "Dev buy", amountLamports: "100000000" }],
    },
    mainWalletPublicKey: "Main111111111111111111111111111111111111111",
    creatorWalletPublicKey: "Dev222222222222222222222222222222222222222",
    creatorWalletOption: "generate",
    managedWallets: [
      {
        publicKey: "Dev222222222222222222222222222222222222222",
        platformRole: "creator",
        isManaged: true,
        fundedCapLamports: "200000000",
      },
    ],
    creatorBuyLamports: "100000000",
    bundlerBuyLamportsByWallet: [],
    jitoTipLamports: "0",
    mainReserveLamports: "0",
    intendedEffects: {
      bundleBuyEnabled: false,
      mayhemMode: false,
      distributionWalletMultiplier: 1,
    },
    bundlerBuyAllocationUsedFallback: false,
    platformFeeWaived: false,
    platformFeeDiscountRate: 0,
    hasSufficientMainWallet: true,
    mainWalletBalanceLamports: "5000000000",
  });

  assert.equal(plan.schemaVersion, PUMPFUN_PLAN_SCHEMA_VERSION_V1);
  assert.equal(plan.platform, "PUMPFUN");
  assert.equal(
    plan.recovery.capsByWalletPublicKey[
      "Dev222222222222222222222222222222222222222"
    ],
    "200000000"
  );
  assert.equal("reservedVanityMintId" in plan.opaque, false);
  assert.equal("vanityMint" in plan.intendedEffects, false);
  assert.equal(planPayloadContainsSecretMaterial(plan), false);
});

test("planPayloadContainsSecretMaterial detects private key fields", async () => {
  stubServerOnlyModule();
  const { planPayloadContainsSecretMaterial } = await import(
    "./launch-platform-pumpfun-plan"
  );

  assert.equal(
    planPayloadContainsSecretMaterial({
      wallets: { privateKey: "secret" },
    }),
    true
  );
  assert.equal(
    planPayloadContainsSecretMaterial({
      config: { importedDevWalletKey: "abc" },
    }),
    true
  );
  assert.equal(planPayloadContainsSecretMaterial({ ok: true }), false);
});
