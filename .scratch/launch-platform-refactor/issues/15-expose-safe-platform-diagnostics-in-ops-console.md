# 15 — Expose safe Platform diagnostics in the Ops Console

**What to build:** Operators can inspect Launch Platform and version, whether an authoritative plan exists, a normalized plan summary where safe, outcome classification, and useful Jito evidence without exposing private keys or dumping raw opaque plan payloads by default.

**Blocked by:** 11 — Classify outcomes, cancellation, and recovery from durable evidence; 12 — Deepen Jito submission and return bookkeeping to callers

**Status:** done

- [x] Ops Launch list and detail surfaces show Platform, Platform version, plan presence, and outcome classification for new-version attempts.
- [x] Ops can view a normalized monetary plan summary and Platform-specific operational details that aid incident response without secret material.
- [x] Raw opaque plan payloads and private keys are not exposed by default in Ops reads.
- [x] Jito-related telemetry retained on the attempt is sufficient to diagnose endpoint, bundle, resend, and confirmation failures from Ops views.
- [x] Legacy attempts remain inspectable with null-version identity and without implying unsupported retry or clone operations.
