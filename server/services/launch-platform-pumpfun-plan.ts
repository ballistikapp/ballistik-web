import "server-only";

import {
  PUMPFUN_PLAN_SCHEMA_VERSION_V1,
  pumpfunLaunchPlanV1Schema,
  type PumpfunLaunchPlanV1,
} from "@/server/schemas/launch-platform.schema";

export type PumpfunPlanWalletDraft =
  PumpfunLaunchPlanV1["wallets"]["managedWallets"][number];

export type AssemblePumpfunLaunchPlanInput = {
  money: PumpfunLaunchPlanV1["money"];
  mainWalletPublicKey: string;
  creatorWalletPublicKey: string;
  creatorWalletOption: PumpfunLaunchPlanV1["wallets"]["creatorWalletOption"];
  managedWallets: PumpfunPlanWalletDraft[];
  creatorBuyLamports: string;
  bundlerBuyLamportsByWallet: PumpfunLaunchPlanV1["allocations"]["bundlerBuyLamportsByWallet"];
  jitoTipLamports: string;
  mainReserveLamports: string;
  intendedEffects: PumpfunLaunchPlanV1["intendedEffects"];
  reservedVanityMintId: string | null;
  reservedVanityMintPublicKey: string | null;
  bundlerBuyAllocationUsedFallback: boolean;
  platformFeeWaived: boolean;
  platformFeeDiscountRate: number;
  hasSufficientMainWallet: boolean;
  mainWalletBalanceLamports: string;
};

/**
 * Assemble the secret-free pump.fun plan document from already-resolved
 * identities and allocations. Does not touch the database or chain.
 */
export function assemblePumpfunLaunchPlan(
  input: AssemblePumpfunLaunchPlanInput
): PumpfunLaunchPlanV1 {
  const capsByWalletPublicKey: Record<string, string> = {};
  for (const wallet of input.managedWallets) {
    capsByWalletPublicKey[wallet.publicKey] = wallet.fundedCapLamports;
  }

  const plan = {
    schemaVersion: PUMPFUN_PLAN_SCHEMA_VERSION_V1,
    platform: "PUMPFUN" as const,
    money: input.money,
    wallets: {
      mainWalletPublicKey: input.mainWalletPublicKey,
      creatorWalletPublicKey: input.creatorWalletPublicKey,
      creatorWalletOption: input.creatorWalletOption,
      managedWallets: input.managedWallets,
    },
    allocations: {
      creatorBuyLamports: input.creatorBuyLamports,
      bundlerBuyLamportsByWallet: input.bundlerBuyLamportsByWallet,
      jitoTipLamports: input.jitoTipLamports,
      mainReserveLamports: input.mainReserveLamports,
    },
    intendedEffects: input.intendedEffects,
    recovery: {
      policy: "plan_funded_cap" as const,
      capsByWalletPublicKey,
    },
    opaque: {
      reservedVanityMintId: input.reservedVanityMintId,
      reservedVanityMintPublicKey: input.reservedVanityMintPublicKey,
      bundlerBuyAllocationUsedFallback: input.bundlerBuyAllocationUsedFallback,
      platformFeeWaived: input.platformFeeWaived,
      platformFeeDiscountRate: input.platformFeeDiscountRate,
      hasSufficientMainWallet: input.hasSufficientMainWallet,
      mainWalletBalanceLamports: input.mainWalletBalanceLamports,
    },
  };

  return pumpfunLaunchPlanV1Schema.parse(plan);
}

/** True when a value looks like it could be a Solana secret key encoding. */
export function planPayloadContainsSecretMaterial(value: unknown): boolean {
  const json = JSON.stringify(value);
  if (!json) {
    return false;
  }
  // bs58 secret keys are typically 64+ chars; never expect privateKey fields.
  if (/"privateKey"\s*:/i.test(json)) {
    return true;
  }
  if (/"secretKey"\s*:/i.test(json)) {
    return true;
  }
  if (/"importedDevWalletKey"\s*:/i.test(json)) {
    return true;
  }
  return false;
}
