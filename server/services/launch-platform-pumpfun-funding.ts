import "server-only";

import { AppError } from "@/server/errors";
import {
  pumpfunLaunchPlanV1Schema,
  type PumpfunLaunchPlanV1,
} from "@/server/schemas/launch-platform.schema";

export type PumpfunPlanFundingTarget = {
  publicKey: string;
  requiredLamports: bigint;
};

export type PumpfunPlanFundingTargets = {
  fundingTargets: PumpfunPlanFundingTarget[];
  mainReserveLamports: bigint;
  tipLamports: bigint;
};

/**
 * Map pump.fun Platform roles onto the legacy LaunchRecoveryWallet enums
 * still used by reclaim UI and recovery queries.
 */
const PLATFORM_ROLE_TO_LEGACY = {
  creator: { walletType: "DEV", role: "DEV" },
  bundler: { walletType: "BUNDLER", role: "BUNDLER" },
  distribution: { walletType: "DISTRIBUTION", role: "DISTRIBUTION" },
} as const;

export type ManagedLaunchWalletRowFromPlan = {
  launchId: string;
  walletPublicKey: string;
  walletType: "DEV" | "BUNDLER" | "DISTRIBUTION";
  role: "DEV" | "BUNDLER" | "DISTRIBUTION";
  platformRole: string;
  isManaged: boolean;
};

/**
 * Derive main-Wallet funding targets from the authoritative plan.
 * `fundedCapLamports` is the required balance target for this attempt;
 * actual top-ups (recovery caps) are recorded after funding.
 */
export function buildFundingTargetsFromPumpfunPlan(
  plan: PumpfunLaunchPlanV1
): PumpfunPlanFundingTargets {
  const fundingTargets = plan.wallets.managedWallets
    .map((wallet) => ({
      publicKey: wallet.publicKey,
      requiredLamports: BigInt(wallet.fundedCapLamports),
    }))
    .filter((target) => target.requiredLamports > BigInt(0));

  return {
    fundingTargets,
    mainReserveLamports: BigInt(plan.allocations.mainReserveLamports),
    tipLamports: BigInt(plan.allocations.jitoTipLamports),
  };
}

/**
 * Build Managed Launch Wallet persistence rows from plan identities/roles.
 * Does not include secrets or funded top-up amounts.
 */
export function buildManagedLaunchWalletRowsFromPumpfunPlan(
  launchId: string,
  plan: PumpfunLaunchPlanV1
): ManagedLaunchWalletRowFromPlan[] {
  return plan.wallets.managedWallets.map((wallet) => {
    const legacy =
      PLATFORM_ROLE_TO_LEGACY[
        wallet.platformRole as keyof typeof PLATFORM_ROLE_TO_LEGACY
      ];
    if (!legacy) {
      throw new AppError(
        `Unsupported pump.fun managed wallet role: ${wallet.platformRole}`,
        500
      );
    }

    return {
      launchId,
      walletPublicKey: wallet.publicKey,
      walletType: legacy.walletType,
      role: legacy.role,
      platformRole: wallet.platformRole,
      isManaged: wallet.isManaged,
    };
  });
}

/** True when a validated plan requires funded-cap reclaim. */
export function launchUsesPlanFundedCapRecovery(plan: unknown): boolean {
  const parsed = pumpfunLaunchPlanV1Schema.safeParse(plan);
  return (
    parsed.success && parsed.data.recovery.policy === "plan_funded_cap"
  );
}
