import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { solToLamportsString } from "@/lib/launch/lamports";
import { PUMPFUN_MONEY_LINE_LABELS } from "@/lib/launch/money-labels";
import {
  descriptionAttributionRemovalFeeSol,
  vanityMintFeeSol,
} from "@/lib/config/usage-fees.config";

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

const baseMoney = {
  immediateRequiredBalanceLamports: "1000000000",
  temporaryFundingLamports: "500000000",
  permanentSpendLamports: "200000000",
  expectedReturnLamports: "300000000",
  expectedMainWalletDeltaNowLamports: "-1000000000",
  expectedMainWalletDeltaAfterCleanupLamports: "-200000000",
  usageFeeLamports: "50000000",
  lineItems: [{ label: "Dev buy", amountLamports: "100000000" }],
};

test("quoteLaunchOptionsFees prices vanity and attribution from Launch Options", async () => {
  stubServerOnlyModule();
  const { quoteLaunchOptionsFees } = await import("./launch-options-money");

  const quoted = quoteLaunchOptionsFees(
    { vanityMint: true, removeAttribution: true },
    { platformFeeWaived: false, platformFeeDiscountRate: 0 }
  );

  assert.equal(quoted.vanityMintFeeSol, vanityMintFeeSol);
  assert.equal(quoted.attributionRemovalFeeSol, descriptionAttributionRemovalFeeSol);
  assert.equal(
    quoted.totalFeeSol,
    vanityMintFeeSol + descriptionAttributionRemovalFeeSol
  );
});

test("mergeLaunchOptionsFeesIntoMoney adds options fees without pump inventing them", async () => {
  stubServerOnlyModule();
  const {
    mergeLaunchOptionsFeesIntoMoney,
    quoteLaunchOptionsFees,
  } = await import("./launch-options-money");

  const optionsFees = quoteLaunchOptionsFees(
    { vanityMint: true, removeAttribution: false },
    { platformFeeWaived: false, platformFeeDiscountRate: 0 }
  );
  const merged = mergeLaunchOptionsFeesIntoMoney(baseMoney, optionsFees);
  const vanityLamports = solToLamportsString(vanityMintFeeSol);

  assert.equal(
    merged.immediateRequiredBalanceLamports,
    (BigInt(baseMoney.immediateRequiredBalanceLamports) + BigInt(vanityLamports)).toString()
  );
  assert.equal(
    merged.usageFeeLamports,
    (BigInt(baseMoney.usageFeeLamports) + BigInt(vanityLamports)).toString()
  );
  assert.ok(
    merged.lineItems.some(
      (item) =>
        item.label === PUMPFUN_MONEY_LINE_LABELS.vanityMintFee &&
        item.amountLamports === vanityLamports
    )
  );
  assert.equal(
    merged.lineItems.some(
      (item) => item.label === PUMPFUN_MONEY_LINE_LABELS.attributionRemovalFee
    ),
    false
  );
});
