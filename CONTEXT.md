# Ballistik

Solana token launch and operations platform. Users create pump.fun tokens, manage bundled launches, run volume bots, and manage exits from a single dashboard.

## Language

**Ops Console**:
An internal tool used only by Ballistik staff to inspect and operate on platform state when something goes wrong or needs manual intervention.
_Avoid_: Admin panel, backoffice, dashboard (the user-facing product is already called the dashboard)

**Operator**:
A Ballistik staff member authorized to use the Ops Console.
_Avoid_: Admin, support agent, staff user (until roles are differentiated)

**User**:
A person who authenticates to the product with a wallet and owns tokens, launches, wallets, and volume-bot sessions.
_Avoid_: Account, customer, client (in Ops Console copy and lookup language)

**Launch**:
A token creation pipeline run for a User — from setup through bundled buys — with stages, logs, and optional recovery state.
_Avoid_: Token creation, mint job (when referring to the pipeline itself, not the on-chain mint)
)
