# 03 — Accept only versioned pump.fun Launch submissions

**What to build:** New Launch submissions persist explicit pump.fun Platform identity and versioned input; system creator Wallet, SPL execution, and EVM placeholders are rejected at the API and funnel, while users still see pump.fun as the working Platform and SPL as coming soon.

**Blocked by:** 02 — Apply the Launch Platform database migration

**Status:** ready-for-agent

- [ ] Schema-valid new Launch submissions persist Platform identity and the first explicit Platform version for both Launch and resulting Token records when a Token is created.
- [ ] New submissions accept only the pump.fun Platform branch; SPL cannot be submitted as a persisted execution state.
- [ ] System dev-wallet option is rejected for new submissions while main, generated, and imported creator Wallet paths remain supported.
- [ ] EVM is removed from user-facing Platform selection and cannot be submitted.
- [ ] Requests rejected by the external input schema still create no Launch record.
- [ ] Existing legacy flat input rows remain readable and are not migrated into the new discriminated shape by this ticket.
