import "server-only";

import { AppError } from "@/server/errors";
import type { ContextUser } from "@/server/schemas/auth.schema";
import { solToLamportsString } from "@/lib/launch/lamports";
import { PUMPFUN_MONEY_LINE_LABELS } from "@/lib/launch/money-labels";
import {
  versionedLaunchPreviewInputSchema,
  type LaunchPlatformPreviewResult,
  type NormalizedLaunchMoneySummary,
  type VersionedLaunchInput,
  type VersionedLaunchPreviewInput,
} from "@/server/schemas/launch-platform.schema";
import type {
  LaunchLifecycleContext,
  LaunchPlatformExecuteResult,
  LaunchPlatformModule,
  LaunchPlatformPlanLocalResources,
  LaunchPlatformPlanResult,
} from "@/server/services/launch-platform-registry";

type RequestUser = Pick<ContextUser, "id" | "plan">;

/** Cost snapshot shape produced by the existing launch cost calculator. */
export type PumpfunLegacyCostPreview = {
  platformFeeWaived: boolean;
  platformFeeDiscountRate: number;
  mainWalletBalanceLamports: string;
  requiredMainWalletLamports: string;
  hasSufficientMainWallet: boolean;
  chargedNowSol: number;
  temporaryFundingSol: number;
  expectedReturnSol: number;
  permanentSpendSol: number;
  netMainWalletDeltaAfterCleanupSol: number;
  lineItems: {
    usageFeesSol: number;
    descriptionAttributionRemovalFeeSol: number;
    bundleBuyFeeSol: number;
    vanityMintFeeSol: number;
    generatedWalletsBilledForFeeCount: number;
    generatedWalletFeeSol: number;
    nonSystemDevWalletFeeSol: number;
    devBuySol: number;
    bundleBuyBaseSol: number;
    creatorReserveSol: number;
    jitoTipSol: number;
    buyWalletReserveSol: number;
    transferReserveSol: number;
    ataRentSol: number;
    userVolumeAccumulatorRentSol: number;
    totalDistributionAtaSol: number;
  };
};

export type PumpfunPlatformModuleDeps = {
  calculateCostPreview: (
    input: VersionedLaunchPreviewInput["config"],
    user: RequestUser
  ) => Promise<PumpfunLegacyCostPreview>;
  buildPlan: (
    ctx: LaunchLifecycleContext,
    input: VersionedLaunchInput
  ) => Promise<LaunchPlatformPlanResult>;
  compensatePlanResources: (
    ctx: LaunchLifecycleContext,
    resources: LaunchPlatformPlanLocalResources
  ) => Promise<void>;
};

function lineItem(label: string, sol: number) {
  return { label, amountLamports: solToLamportsString(sol) };
}

/**
 * Map the legacy SOL cost preview into the shared normalized money summary.
 * Signed main-wallet deltas are outflows (negative).
 */
export function mapPumpfunCostPreviewToNormalizedMoney(
  preview: PumpfunLegacyCostPreview
): NormalizedLaunchMoneySummary {
  const items = preview.lineItems;
  const generatedLabel =
    items.generatedWalletsBilledForFeeCount > 0
      ? `${PUMPFUN_MONEY_LINE_LABELS.generatedWalletFee} (${items.generatedWalletsBilledForFeeCount})`
      : PUMPFUN_MONEY_LINE_LABELS.generatedWalletFee;

  return {
    immediateRequiredBalanceLamports: preview.requiredMainWalletLamports,
    temporaryFundingLamports: solToLamportsString(preview.temporaryFundingSol),
    permanentSpendLamports: solToLamportsString(preview.permanentSpendSol),
    expectedReturnLamports: solToLamportsString(preview.expectedReturnSol),
    expectedMainWalletDeltaNowLamports: `-${preview.requiredMainWalletLamports}`,
    expectedMainWalletDeltaAfterCleanupLamports: `-${solToLamportsString(
      preview.netMainWalletDeltaAfterCleanupSol
    )}`,
    usageFeeLamports: solToLamportsString(items.usageFeesSol),
    lineItems: [
      lineItem(PUMPFUN_MONEY_LINE_LABELS.usageFees, items.usageFeesSol),
      lineItem(generatedLabel, items.generatedWalletFeeSol),
      lineItem(
        PUMPFUN_MONEY_LINE_LABELS.customDevWalletFee,
        items.nonSystemDevWalletFeeSol
      ),
      lineItem(PUMPFUN_MONEY_LINE_LABELS.vanityMintFee, items.vanityMintFeeSol),
      lineItem(
        PUMPFUN_MONEY_LINE_LABELS.attributionRemovalFee,
        items.descriptionAttributionRemovalFeeSol
      ),
      lineItem(PUMPFUN_MONEY_LINE_LABELS.bundleBuyFee, items.bundleBuyFeeSol),
      lineItem(PUMPFUN_MONEY_LINE_LABELS.devBuy, items.devBuySol),
      lineItem(PUMPFUN_MONEY_LINE_LABELS.bundleBuy, items.bundleBuyBaseSol),
      lineItem(PUMPFUN_MONEY_LINE_LABELS.jitoTip, items.jitoTipSol),
      lineItem(PUMPFUN_MONEY_LINE_LABELS.creatorReserve, items.creatorReserveSol),
      lineItem(
        PUMPFUN_MONEY_LINE_LABELS.buyWalletReserve,
        items.buyWalletReserveSol
      ),
      lineItem(
        PUMPFUN_MONEY_LINE_LABELS.transferReserve,
        items.transferReserveSol
      ),
      lineItem(PUMPFUN_MONEY_LINE_LABELS.ataRent, items.ataRentSol),
      lineItem(
        PUMPFUN_MONEY_LINE_LABELS.userVolumeAccumulatorRent,
        items.userVolumeAccumulatorRentSol
      ),
      lineItem(
        PUMPFUN_MONEY_LINE_LABELS.distributionAtaRent,
        items.totalDistributionAtaSol
      ),
      lineItem(PUMPFUN_MONEY_LINE_LABELS.expectedReturn, preview.expectedReturnSol),
    ],
  };
}

function toPreviewResult(
  preview: PumpfunLegacyCostPreview
): LaunchPlatformPreviewResult {
  return {
    money: mapPumpfunCostPreviewToNormalizedMoney(preview),
    mainWalletBalanceLamports: preview.mainWalletBalanceLamports,
    hasSufficientMainWallet: preview.hasSufficientMainWallet,
    platformFeeWaived: preview.platformFeeWaived,
    platformFeeDiscountRate: preview.platformFeeDiscountRate,
  };
}

async function defaultCalculateCostPreview(
  config: VersionedLaunchPreviewInput["config"],
  user: RequestUser
): Promise<PumpfunLegacyCostPreview> {
  const { calculateLaunchCostPreview } = await import("./launch.service");
  return calculateLaunchCostPreview(config, user);
}

async function defaultBuildPlan(
  ctx: LaunchLifecycleContext,
  input: VersionedLaunchInput
): Promise<LaunchPlatformPlanResult> {
  const { buildPumpfunAuthoritativePlan } = await import("./launch.service");
  return buildPumpfunAuthoritativePlan({
    launchId: ctx.launchId,
    userId: ctx.userId,
    input,
  });
}

async function defaultCompensatePlanResources(
  _ctx: LaunchLifecycleContext,
  resources: LaunchPlatformPlanLocalResources
): Promise<void> {
  const { compensatePumpfunPlanResources } = await import("./launch.service");
  await compensatePumpfunPlanResources(resources);
}

function notExtractedYet(operation: string): never {
  throw new AppError(
    `pump.fun Platform ${operation} is not extracted yet`,
    501,
    { operation }
  );
}

/**
 * pump.fun Platform module.
 * preview and plan are implemented; recover deepens later.
 * execute still delegates to the existing launch job (compat), which reads the
 * persisted plan for wallet identities and vanity reservations when present.
 */
export function createPumpfunPlatformModule(
  deps: Partial<PumpfunPlatformModuleDeps> = {}
): LaunchPlatformModule {
  const calculateCostPreview =
    deps.calculateCostPreview ?? defaultCalculateCostPreview;
  const buildPlan = deps.buildPlan ?? defaultBuildPlan;
  const compensatePlanResources =
    deps.compensatePlanResources ?? defaultCompensatePlanResources;

  return {
    id: "PUMPFUN",
    preview: async (input, ctx) => {
      const parsed = versionedLaunchPreviewInputSchema.safeParse(input);
      if (!parsed.success) {
        const message =
          parsed.error.issues[0]?.message ?? "Invalid launch preview input";
        throw new AppError(message, 400, { issues: parsed.error.issues });
      }
      const preview = await calculateCostPreview(parsed.data.config, ctx.user);
      return toPreviewResult(preview);
    },
    plan: async (ctx, input) => buildPlan(ctx, input),
    execute: async (ctx: LaunchLifecycleContext) => {
      await runPumpfunLaunchJobCompat(ctx.launchId);
      return { kind: "compat" } satisfies LaunchPlatformExecuteResult;
    },
    recover: async () => notExtractedYet("recover"),
    compensatePlanResources,
  };
}

/**
 * pump.fun Platform compatibility entry points.
 * Execute still delegates to the existing launch job. The job reuses persisted
 * plan identities/vanity when present; funding amounts may still be recomputed
 * until Managed Launch Wallet funding extraction (ticket 08).
 */
export async function runPumpfunLaunchJobCompat(launchId: string): Promise<void> {
  const { launchService } = await import("./launch.service");
  await launchService.runLaunchJob(launchId);
}
