# 01 — Open Referrals + Marketer Application (User + Ops)

**What to build:** Every authenticated User sees Referrals in the Account nav and can open `/referrals`. Non-Marketers submit a Marketer Application with a required message, see pending/rejected (with optional Operator note), and may resubmit only after reject (new Application; at most one pending). Operators have an Applications inbox: list/detail, reject with optional note, and create-Marketer prefilled from an Application; creating a Marketer for that User auto-approves their pending Application so they land on the Marketer dashboard. Disabled Marketers get a read-only historical Referrals view (setup/lists/aggregates visible; no writes; no new Application). Intake only — rates and designation stay Operator-owned. Domain language: Marketer Application (see `CONTEXT.md`); ADRs 0004/0005 unchanged.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] Account nav shows Referrals for all authenticated Users; `/referrals` no longer redirects non-Marketers away
- [x] Non-Marketer can submit a Marketer Application (required, length-capped message) and see pending state
- [x] User cannot submit a second Application while one is pending
- [x] After reject (optional note), User sees rejected state and can submit a new Application
- [x] Operators can list/open Applications and reject with optional note
- [x] Ops create-Marketer from an Application prefills the User; create auto-approves that User’s pending Application
- [x] Creating a Marketer with no pending Application is unchanged (no Application side effects)
- [x] Enabled Marketer still gets the existing setup + referred Users + payouts surface
- [x] Disabled Marketer sees read-only history; cannot edit setup or apply again
- [x] Service-level tests cover Application submit rules, reject, and auto-approve on Marketer create
