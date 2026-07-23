import {
  bundleBuyFeeSol,
  descriptionAttributionRemovalFeeSol,
  vanityMintFeeSol,
} from "@/lib/config/usage-fees.config";
import { PUMPFUN_MONEY_LINE_LABELS } from "@/lib/launch/money-labels";
import {
  findMoneyLineItem,
  lamportsStringToSol,
} from "@/lib/launch/lamports";
import type { LaunchPlatformPreviewResult } from "@/server/schemas/launch-platform.schema";

function lineAmountSol(
  lineItems: ReadonlyArray<{ label: string; amountLamports: string }>,
  label: string
): number {
  const lamports = findMoneyLineItem(lineItems, label);
  return lamports ? lamportsStringToSol(lamports) : 0;
}

function findGeneratedWalletFee(
  lineItems: ReadonlyArray<{ label: string; amountLamports: string }>
) {
  const exact = lineItems.find(
    (item) => item.label === PUMPFUN_MONEY_LINE_LABELS.generatedWalletFee
  );
  if (exact) {
    return { amountLamports: exact.amountLamports, walletCount: 0 };
  }
  const prefixed = lineItems.find((item) =>
    item.label.startsWith(`${PUMPFUN_MONEY_LINE_LABELS.generatedWalletFee} (`)
  );
  if (!prefixed) {
    return { amountLamports: "0", walletCount: 0 };
  }
  const match = /\((\d+)\)/.exec(prefixed.label);
  return {
    amountLamports: prefixed.amountLamports,
    walletCount: match ? Number(match[1]) : 0,
  };
}

export type PreviewMoneyDisplay = {
  usageFeeSol: number;
  generatedWalletFeeSol: number;
  generatedWalletCountFromLabel: number;
  customDevWalletFeeSol: number;
  vanityFeeSol: number;
  attributionFeeSol: number;
  bundleFeeSol: number;
  estimatedSpendSol: number;
  creatorReserveSol: number;
  buyWalletReserveSol: number;
  transferReserveSol: number;
  platformFeeWaived: boolean;
  platformFeeDiscountRate: number;
};

/** Derive review/overview display amounts from the ticket-06 preview envelope. */
export function toPreviewMoneyDisplay(
  preview: LaunchPlatformPreviewResult | undefined,
  options: {
    vanityMint: boolean;
    removeAttribution: boolean;
    bundleBuyEnabled: boolean;
  }
): PreviewMoneyDisplay | null {
  if (!preview) {
    return null;
  }
  const lineItems = preview.money.lineItems;
  const generatedWalletFee = findGeneratedWalletFee(lineItems);
  return {
    usageFeeSol: lamportsStringToSol(preview.money.usageFeeLamports),
    generatedWalletFeeSol: lamportsStringToSol(
      generatedWalletFee.amountLamports
    ),
    generatedWalletCountFromLabel: generatedWalletFee.walletCount,
    customDevWalletFeeSol: lineAmountSol(
      lineItems,
      PUMPFUN_MONEY_LINE_LABELS.customDevWalletFee
    ),
    vanityFeeSol: options.vanityMint
      ? lineAmountSol(lineItems, PUMPFUN_MONEY_LINE_LABELS.vanityMintFee)
      : vanityMintFeeSol,
    attributionFeeSol: options.removeAttribution
      ? lineAmountSol(
          lineItems,
          PUMPFUN_MONEY_LINE_LABELS.attributionRemovalFee
        )
      : descriptionAttributionRemovalFeeSol,
    bundleFeeSol: options.bundleBuyEnabled
      ? lineAmountSol(lineItems, PUMPFUN_MONEY_LINE_LABELS.bundleBuyFee)
      : bundleBuyFeeSol,
    estimatedSpendSol: Math.abs(
      lamportsStringToSol(
        preview.money.expectedMainWalletDeltaAfterCleanupLamports
      )
    ),
    creatorReserveSol: lineAmountSol(
      lineItems,
      PUMPFUN_MONEY_LINE_LABELS.creatorReserve
    ),
    buyWalletReserveSol: lineAmountSol(
      lineItems,
      PUMPFUN_MONEY_LINE_LABELS.buyWalletReserve
    ),
    transferReserveSol: lineAmountSol(
      lineItems,
      PUMPFUN_MONEY_LINE_LABELS.transferReserve
    ),
    platformFeeWaived: preview.platformFeeWaived,
    platformFeeDiscountRate: preview.platformFeeDiscountRate,
  };
}
