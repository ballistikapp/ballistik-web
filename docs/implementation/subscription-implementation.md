# Subscription Implementation

## Goal

Add a tiered weekly subscription system with `DEVELOPER` and `PRO` plans, managed entirely inside the app.

## Product Rules

- Three tiers: `FREE`, `DEVELOPER`, `PRO`.
- `DEVELOPER` costs `1.95 SOL` per week. `PRO` costs `4.95 SOL` per week.
- Both paid plans are account-wide and last 7 days per purchase.
- `DEVELOPER` provides a 25% discount on platform usage fees and unlocks all dev wallet options during launch.
- `PRO` waives platform fees entirely and unlocks gRPC features (live monitoring, fast confirmation).
- `DEVELOPER` does not unlock gRPC access.
- There is no auto-renewal in v1.
- Users manage subscriptions from `/account/subscription`.

## Payment Model

- Payment is charged from the user's main wallet.
- The existing `FEE_COLLECTOR_WALLET_ADDRESS` remains the recipient.
- The existing server-side SOL transfer flow is reused.
- A successful charge must be confirmed on-chain before plan access is granted.

## Data Model

### `User`

- `plan`: `FREE | DEVELOPER | PRO`
- `paidPlanStartedAt` (`@map("proStartedAt")`): start of the current or latest paid plan window
- `paidPlanExpiresAt` (`@map("proExpiresAt")`): end of the current paid plan window

### `SubscriptionPayment` (`@@map("ProSubscriptionPayment")`)

- `userId`
- `plan`: which plan was purchased (`DEVELOPER` or `PRO`)
- `amountSol`
- `txSignature`
- `startsAt`
- `expiresAt`
- `createdAt`

This model supports billing history and support/debugging for all subscription purchases.

## Entitlement Rules

- JWT remains the request-time source of truth for feature gating.
- `resolveEffectiveUserPlan(storedPlan, paidPlanExpiresAt)` determines the current effective plan: returns the stored plan if the paid window is active, else `FREE`.
- Weekly purchases force a token refresh so the user gets the new plan immediately.
- Plan expiry is normalized back to `FREE` during normal auth refresh/login flows.
- No background job or scheduler is required for expiry handling.

## Renewal and Upgrade Rules

- **Renewal**: Buying the same plan while it's active stacks another 7 days from the current expiry.
- **Upgrade (DEVELOPER → PRO)**: Remaining Developer days are credited. Days are rounded up (25 hours = 2 days). The Pro charge is reduced by `(remainingDays / 7) * developerPriceSol`.
- **Downgrade (PRO → DEVELOPER)**: Not allowed while Pro is active. After expiry, the user can purchase Developer normally.

## Fee Policy

Feature gating and fee policy are split:

- `grpcAccessService.getFeatureAccess(user, feature)`: Only `PRO` gets gRPC/realtime. `DEVELOPER` and `FREE` do not.
- `grpcAccessService.getPlatformFeeDiscountRate(user)`: Returns `0` for `FREE`, `0.25` for `DEVELOPER`, `1.0` for `PRO`.
- The discount is applied to the total platform fee, not per line item. Individual line items remain at their nominal values.

## UI Scope

- `/account/subscription` shows two tier cards (Developer and Pro) side by side with purchase/extend/upgrade actions.
- Billing history includes the plan name on each entry.
- Auth button in the header shows the current plan badge and subscription link.
- Dashboard monitoring prompts remain Pro-only.
- Launch form dev wallet options are unlocked for both Developer and Pro.
- Volume bot fee messaging reflects the active plan's discount or waiver.

## Messaging Rules

- Copy is concise and professional.
- Blocked features explain the free-tier fallback briefly and present a clear upgrade CTA.
- Dev wallet options show a `PAID` badge (not `PRO`) when locked, since both paid plans unlock them.
- gRPC/monitoring prompts specifically mention Pro since Developer does not unlock gRPC.
