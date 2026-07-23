# 06 — Provide normalized pump.fun preview and review

**What to build:** Side-effect-free pump.fun preview returns labeled immediate, temporary, permanent, expected-return, and usage-fee amounts plus meaningful line items; the Launch review surface consumes that shared contract instead of duplicating cost math.

**Blocked by:** 05 — Route pump.fun through a shared lifecycle and Platform registry

**Status:** resolved

- [x] Pump.fun preview is side-effect-free, non-authoritative, and safe to call while configuring the funnel.
- [x] Preview returns the shared normalized monetary summary and labeled line items for fees, buys, tips, rent, buffers, and expected returns.
- [x] Launch review and overview surfaces display the normalized summary from the API contract rather than parallel client-only calculations.
- [x] Preview responses remain responsive and do not persist plans, fund Wallets, publish venue metadata, or submit on-chain transactions.
- [x] Unsupported or invalid pump.fun configuration surfaces user-safe validation errors through the preview path where applicable.

## Comments

- Decisions: 1A/2A/3A/4A — keep `launch.previewCosts`, route through Platform `preview(input, { user })`, return envelope `{ money, mainWalletBalanceLamports, hasSufficientMainWallet, platformFeeWaived, platformFeeDiscountRate }`, accept `versionedLaunchPreviewInputSchema` (Platform + config, metadata omitted for edit-time responsiveness). Read-only RPC retained.
- Seams tested: Platform `createPumpfunPlatformModule({ calculateCostPreview }).preview`, and `launchService.previewCosts` via registry. UI wired to lamport line labels; client edit-time fee totals still use local usage-fee helpers.
