import "server-only";

import {
  descriptionAttributionRemovalFeeSol,
  vanityMintFeeSol,
} from "@/lib/config/usage-fees.config";
import { solToLamportsString } from "@/lib/launch/lamports";
import { PUMPFUN_MONEY_LINE_LABELS } from "@/lib/launch/money-labels";
import type {
  LaunchOptions,
  NormalizedLaunchMoneySummary,
} from "@/server/schemas/launch-platform.schema";

export type LaunchOptionsFeeQuote = {
  vanityMintFeeSol: number;
  attributionRemovalFeeSol: number;
  totalFeeSol: number;
};

/**
 * Quote vanity + Launch Attribution usage fees from Launch Options.
 * Applies the same waive/discount policy the Platform fee path uses.
 */
export function quoteLaunchOptionsFees(
  options: LaunchOptions,
  policy: { platformFeeWaived: boolean; platformFeeDiscountRate: number }
): LaunchOptionsFeeQuote {
  if (policy.platformFeeWaived) {
    return {
      vanityMintFeeSol: 0,
      attributionRemovalFeeSol: 0,
      totalFeeSol: 0,
    };
  }

  const rate = Math.min(1, Math.max(0, policy.platformFeeDiscountRate));
  const scale = 1 - rate;
  const vanity = options.vanityMint ? vanityMintFeeSol * scale : 0;
  const attribution = options.removeAttribution
    ? descriptionAttributionRemovalFeeSol * scale
    : 0;

  return {
    vanityMintFeeSol: vanity,
    attributionRemovalFeeSol: attribution,
    totalFeeSol: vanity + attribution,
  };
}

function addLamports(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

function negateLamports(value: string): string {
  const n = BigInt(value);
  return n === BigInt(0) ? "0" : (-n).toString();
}

/**
 * Compose Launch Options fees into a Platform money summary.
 * Pump preview/plan money must not invent vanity/attribution line items;
 * the shared lifecycle applies them here.
 */
export function mergeLaunchOptionsFeesIntoMoney(
  money: NormalizedLaunchMoneySummary,
  optionsFees: LaunchOptionsFeeQuote
): NormalizedLaunchMoneySummary {
  if (optionsFees.totalFeeSol <= 0) {
    return money;
  }

  const optionsFeeLamports = solToLamportsString(optionsFees.totalFeeSol);
  const vanityLamports = solToLamportsString(optionsFees.vanityMintFeeSol);
  const attributionLamports = solToLamportsString(
    optionsFees.attributionRemovalFeeSol
  );

  const immediate = addLamports(
    money.immediateRequiredBalanceLamports,
    optionsFeeLamports
  );
  const permanent = addLamports(
    money.permanentSpendLamports,
    optionsFeeLamports
  );
  const usage = addLamports(money.usageFeeLamports, optionsFeeLamports);

  const afterCleanupBase = money.expectedMainWalletDeltaAfterCleanupLamports.startsWith(
    "-"
  )
    ? money.expectedMainWalletDeltaAfterCleanupLamports.slice(1)
    : money.expectedMainWalletDeltaAfterCleanupLamports;
  const afterCleanup = addLamports(afterCleanupBase, optionsFeeLamports);

  const lineItems = [...money.lineItems];
  if (optionsFees.vanityMintFeeSol > 0) {
    lineItems.push({
      label: PUMPFUN_MONEY_LINE_LABELS.vanityMintFee,
      amountLamports: vanityLamports,
    });
  }
  if (optionsFees.attributionRemovalFeeSol > 0) {
    lineItems.push({
      label: PUMPFUN_MONEY_LINE_LABELS.attributionRemovalFee,
      amountLamports: attributionLamports,
    });
  }

  return {
    ...money,
    immediateRequiredBalanceLamports: immediate,
    permanentSpendLamports: permanent,
    usageFeeLamports: usage,
    expectedMainWalletDeltaNowLamports: negateLamports(immediate),
    expectedMainWalletDeltaAfterCleanupLamports: negateLamports(afterCleanup),
    lineItems,
  };
}
