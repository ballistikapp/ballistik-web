# Ballistik

Solana token launch and operations platform. Users create pump.fun tokens, manage bundled launches, run volume bots, and manage exits from a single dashboard.

## Language

**Ops Console**:
An internal tool used only by Ballistik staff to inspect and operate on platform state when something goes wrong or needs manual intervention.
_Avoid_: Admin panel, backoffice, dashboard (the user-facing product is already called the dashboard)

**Ops Overview**:
The Ops Console home surface with platform summary metrics and the global jump box.
_Avoid_: Dashboard, admin home (dashboard is the product UI)

**Operator**:
A Ballistik staff member authorized to use the Ops Console.
_Avoid_: Admin, support agent, staff user (until roles are differentiated)

**User**:
A person who authenticates to the product with a wallet and owns tokens, launches, wallets, and volume-bot sessions.
_Avoid_: Account, customer, client (in Ops Console copy and lookup language)

**Launch**:
A token creation pipeline run for a User — from setup through bundled buys — with stages, logs, and optional recovery state.
_Avoid_: Token creation, mint job (when referring to the pipeline itself, not the on-chain mint)

**Token**:
A pump.fun mint owned by a User, with metadata, status, and operational wallets.
_Avoid_: Coin, asset, mint (when referring to the owned record, not the on-chain pubkey alone)

**Wallet**:
A Solana keypair record in the platform — main wallet, operational wallet, or system wallet — with a public key and stored balance.
_Avoid_: Account, address (when referring to the Wallet record, not the pubkey string)
)
