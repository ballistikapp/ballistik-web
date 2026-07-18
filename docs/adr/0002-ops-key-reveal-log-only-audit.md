# Ops key reveal with log-only audit

Ops Console hides private keys by default but allows an Operator to reveal any Wallet private key (including MAIN) and any Token mint private key on demand. Each reveal is recorded only in the application server logs (Operator, target, time) — not in a durable audit table.

We accepted higher custody risk for operational speed: support often needs keys that are already stored plaintext for the owning User. A DB audit table was rejected for v1 to keep scope small; revisit if the Operator set grows or compliance requires queryable history.
