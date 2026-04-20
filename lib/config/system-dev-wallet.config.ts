/**
 * Minimum native SOL (lamports) left on the shared system dev wallet after
 * `sweepSystemDevRealizedSol`, in addition to the chain rent-exempt minimum for
 * an empty account (the sweep keeps `max(rent, this value)` on the wallet).
 */
export const SYSTEM_DEV_OPERATIONAL_RESERVE_LAMPORTS = 10_000_000;
