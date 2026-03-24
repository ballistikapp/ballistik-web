# Subscription Implementation

## Goal

Add a simple weekly Pro subscription flow that is paid from the user's main wallet balance and managed entirely inside the app.

## Product Rules

- Price is `0.95 SOL` per week.
- Pro is account-wide.
- Pro unlocks existing Pro-only gRPC features and platform-fee waivers.
- Pro waives platform fees only; network, protocol, rent, and Jito costs still apply.
- There is no auto-renewal in v1.
- There is no trial in v1.
- Users manage Pro from dedicated account subroutes under `/account`.

## Payment Model

- Payment is charged from the user's main wallet.
- The existing `FEE_COLLECTOR_WALLET_ADDRESS` remains the recipient.
- The existing server-side SOL transfer flow is reused instead of integrating an external billing provider.
- A successful charge must be confirmed on-chain before Pro access is granted.

## Data Model

### `User`

- `plan`: `FREE | PRO`
- `proStartedAt`: start of the current or latest Pro window
- `proExpiresAt`: end of the current Pro window

### `ProSubscriptionPayment`

- `userId`
- `amountSol`
- `txSignature`
- `startsAt`
- `expiresAt`
- `createdAt`

This model exists only to support billing history and support/debugging for Pro purchases.

## Entitlement Rules

- JWT remains the request-time source of truth for feature gating.
- Weekly Pro purchase forces a token refresh so the user gets `plan = PRO` immediately.
- Pro expiry can be normalized back to `FREE` during normal auth refresh/login flows in v1.
- No background job or scheduler is required for expiry handling in this phase.

## UI Scope

- `/account` remains the wallet/profile page.
- `/account/subscription` shows:
  - current plan
  - status
  - expiration date
  - public price
  - purchase action
  - billing history
- Existing upgrade prompts in dashboard and volume bot should link to `/account/subscription`.

## Messaging Rules

- Copy should be concise and professional.
- Blocked features should explain the free-tier fallback briefly and present a clear upgrade CTA.
- Subscription UI should state that Pro removes platform fees only.
