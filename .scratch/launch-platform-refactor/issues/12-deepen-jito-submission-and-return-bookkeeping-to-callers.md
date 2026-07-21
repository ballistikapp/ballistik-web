# 12 — Deepen Jito submission and return bookkeeping to callers

**What to build:** Jito hides simulation, tip placement, transaction versioning, lookup-table compilation, endpoint rotation, resend, and confirmation while returning signatures and structured telemetry; Pump Launch and Holding Exit callers retain ownership of their AppTransaction meanings, including correct Mayhem signature mapping for bundled buys.

**Blocked by:** 10 — Execute bundled and Mayhem Launches through one raw pump path

**Status:** done

- [x] The public Jito submission interface is narrow and hides tip placement, versioning, simulation, resend, rebuild bounds, and confirmation mechanics from callers.
- [x] No bundle is sent after authoritative simulation failure when simulation is enabled for the submission path.
- [x] Jito returns signatures, bundle identity, confirmation evidence, and structured telemetry without writing Launch or Exit bookkeeping rows itself.
- [x] Pump Launch callers create and settle their own AppTransaction records from Jito results.
- [x] Holding Exit callers continue to create and settle their own AppTransaction records from Jito results after the transport refactor.
- [x] Mayhem bundled buy signature-to-transaction mapping stays consistent with actual packing rules so trade and tip rows align with landed bundle structure.
