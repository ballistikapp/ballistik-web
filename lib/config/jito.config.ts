// IMPORTANT: do NOT include the global LB `https://mainnet.block-engine.jito.wtf`.
// The LB is a stateless router across regional engines; bundle tracking lives at
// the regional engine that received the send. Querying inflight at the LB routes
// to a possibly different region and returns `Invalid` for bundleIds it does not
// own. Using only regional endpoints makes per-bundle endpoint pinning meaningful.
const jitoBlockEngineUrls = [
  "https://amsterdam.mainnet.block-engine.jito.wtf",
  "https://dublin.mainnet.block-engine.jito.wtf",
  "https://frankfurt.mainnet.block-engine.jito.wtf",
  "https://london.mainnet.block-engine.jito.wtf",
  "https://ny.mainnet.block-engine.jito.wtf",
  "https://slc.mainnet.block-engine.jito.wtf",
  "https://singapore.mainnet.block-engine.jito.wtf",
  "https://tokyo.mainnet.block-engine.jito.wtf",
  "https://dallas.testnet.block-engine.jito.wtf",
  "https://ny.testnet.block-engine.jito.wtf",
] as const;

export const jitoConfig = {
  blockEngineUrls: jitoBlockEngineUrls,
};

export type JitoBlockEngineUrl = (typeof jitoBlockEngineUrls)[number];

export function getDefaultJitoBlockEngineUrl(): JitoBlockEngineUrl {
  return jitoBlockEngineUrls[0];
}
