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

**Marketer**:
A User designated by an Operator in the Ops Console with a fee-share rate (0–1) that applies to every User they refer. The live rate at each fee collection is what matters — not the rate at signup. The Marketer chooses and may change their referral code; a code change invalidates prior share links, but existing Referrals stay attached. An Operator-only nickname labels the Marketer for Ops memory; it is not the referral code. When an Operator disables a Marketer, their code stops attributing new Users and existing Referrals stop producing Referral Payouts; past payouts remain.
_Avoid_: Referrer, affiliate, partner (when referring to the designated User role)

**Referral**:
The lasting attribution of a User to a Marketer, created only when that User first registers with a valid referral code. Later logins with a code do not create or change a Referral.
_Avoid_: Invite, affiliate link, signup attribution

**Referral Payout**:
The Marketer's share of a referred User's platform payment — usage fees and subscription charges — sent to the Marketer's fee-collector wallet; the remainder goes to the platform fee collector. If the Marketer has no fee-collector wallet set at collection time, there is no Referral Payout and the platform keeps 100%.
_Avoid_: Commission, affiliate earnings, rebate

