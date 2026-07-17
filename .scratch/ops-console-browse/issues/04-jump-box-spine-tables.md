# 04 — Jump box + User spine dense tables

**What to build:** A global jump box (on Ops Overview and/or Ops shell) resolves a pasted main-wallet pubkey, Wallet pubkey, or Token mint to the right Ops detail (User, Wallet, or Token). The User spine nested Tokens / Wallets / Launches lists use the same dense table chrome as the global browse pages, scoped to that User.

**Blocked by:** 02 — Browse Users & Launches; 03 — Browse Tokens & Wallets + detail pages

**Status:** done

- [x] Jump box resolves main-wallet pubkey → User spine
- [x] Jump box resolves Wallet pubkey → Wallet detail
- [x] Jump box resolves Token mint → Token detail
- [x] Unknown identifier yields a clear empty/not-found style result (no privilege leak)
- [x] User spine Tokens, Wallets, and Launches sections use the dense Ops table pattern (user-scoped)
- [x] Nested spine tables still omit private keys and keep reveal on the appropriate detail surfaces
