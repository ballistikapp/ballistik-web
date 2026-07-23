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
A User’s token creation attempt owned by the shared lifecycle — identity, plan durability, progress, cancellation, retry lineage, terminal status, and fee collection — with Platform-specific planning and execution behind a small `preview / plan / execute / recover` interface.
_Avoid_: Token creation, mint job (when referring to the pipeline itself, not the on-chain mint)

**Platform**:
The launch path selected in the funnel: pump.fun or SPL. The SPL Platform means direct mint creation followed by initial liquidity on the DEX chosen by Ballistik; it does not mean that pump.fun tokens are outside the SPL token standards. New backend records accept only pump.fun until an SPL module exists; null Platform version marks legacy Launch/Token records.
_Avoid_: Launch route, launch type, user-selected DEX

**Token**:
A Solana mint owned by a User, with metadata, status, and operational wallets, whether launched through pump.fun or directly on a DEX.
_Avoid_: Coin, asset, mint (when referring to the owned record, not the on-chain pubkey alone)

**Wallet**:
A Solana keypair record in the platform — main wallet, operational wallet, or system wallet — with a public key and stored balance.
_Avoid_: Account, address (when referring to the Wallet record, not the pubkey string)

**Managed Launch Wallet**:
A Wallet temporarily prepared or funded for a Launch and tracked until its Platform-specific cleanup or recovery is complete. Its role is defined by the selected Platform rather than by a global list of launch roles.
_Avoid_: Recovery wallet, bundler wallet (when referring to the cross-Platform concept)

**Launch Options**:
Shared, Platform-agnostic Launch settings — vanity mint intent and whether to remove Launch Attribution — owned by the shared lifecycle, not by any Platform module.
_Avoid_: pump.fun options, product options, shared config (when referring to this bag)

**Launch Attribution**:
The Ballistik product line appended to a Token description at publish time unless the User removes it via Launch Options. Distinct from Referral attribution of a User to a Marketer.
_Avoid_: Attribution (alone), pump attribution, description footer

**Vanity Mint**:
A mint keypair reserved from Ballistik’s pool so the Token address matches a vanity pattern. Requested through Launch Options; the shared lifecycle materializes mint identity for every Launch into a planned-mint record (pool reserve or a fresh key at plan time), then Platforms consume that planned identity at execute.
_Avoid_: custom mint, grinded address, pump vanity (when referring to the cross-Platform intent)

**Planned Mint**:
The durable per-Launch mint identity materialized at plan time (`LaunchPlannedMint`), holding the secret key and optional vanity-pool link. Public fields appear in plan `optionsOutcomes` (`mintPublicKey`, `plannedMintId`); secrets never enter the plan envelope.
_Avoid_: Wallet (for mint secrets), VanityMint (when referring to the per-Launch planned row rather than the pool)

**Marketer**:
A User designated by an Operator in the Ops Console with a fee-share rate (0–1) that applies to every User they refer. The live rate at each fee collection is what matters — not the rate at signup. The Marketer chooses and may change their referral code; a code change invalidates prior share links, but existing Referrals stay attached. An Operator-only nickname labels the Marketer for Ops memory; it is not the referral code. When an Operator disables a Marketer, their code stops attributing new Users and existing Referrals stop producing Referral Payouts; past payouts remain.
_Avoid_: Referrer, affiliate, partner (when referring to the designated User role)

**Marketer Application**:
A User’s request to become a Marketer, carrying a message for Operators and optionally an Operator reject note. Status is pending, approved, or rejected. A User may have at most one pending Application; designation still happens only when an Operator creates the Marketer, which approves the pending Application.
_Avoid_: Affiliate application, partner request, referral signup

**Referral**:
The lasting attribution of a User to a Marketer, created only when that User first registers with a valid referral code. Later logins with a code do not create or change a Referral.
_Avoid_: Invite, affiliate link, signup attribution

**Referral Payout**:
The Marketer's share of a referred User's platform payment — usage fees and subscription charges — sent to the Marketer's fee-collector wallet; the remainder goes to the platform fee collector. If the Marketer has no fee-collector wallet set at collection time, there is no Referral Payout and the platform keeps 100%.
_Avoid_: Commission, affiliate earnings, rebate

