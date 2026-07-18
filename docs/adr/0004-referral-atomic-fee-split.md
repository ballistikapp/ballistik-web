# Atomic dual-transfer for Referral Payouts

When a referred User pays a platform fee (usage or subscription), the Marketer share and platform remainder leave the User's main wallet in a single Solana transaction with two transfers.

We rejected paying the platform first and settling Marketers later (needs a hot wallet / payout job and breaks “fees go directly”), and rejected two sequential transactions (partial-success recovery). Atomic split keeps collection simple and failure modes binary: both legs land or neither does.
