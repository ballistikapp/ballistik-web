# 03 — Browse Tokens & Wallets + detail pages

**What to build:** Dense Ops tables for Tokens and Wallets. The Wallets table includes all Wallet rows (including system), filterable by type/system. Thin Token and Wallet detail pages show identity/status/owner/links and support on-demand key reveal under existing reveal+log rules. Balances shown from stored app state only (no refresh action in this ticket).

**Blocked by:** 01 — Ops shell: sidebar + Ops Overview

**Status:** done

- [x] `/ops/tokens` dense table with pagination, search, and limited sort
- [x] Token row opens a thin Token detail page (metadata, status, owning User; no private key by default)
- [x] Token detail supports mint private-key reveal with existing Operator + log-only audit behavior
- [x] `/ops/wallets` dense table includes all Wallets (including system), with type/system filtering
- [x] Wallet row opens a thin Wallet detail page (type, pubkey, owner, stored balance + refreshed-at)
- [x] Wallet detail supports private-key reveal with existing Operator + log-only audit behavior
- [x] List/detail read payloads omit private keys unless reveal
- [x] Non-Operator access remains not-found
