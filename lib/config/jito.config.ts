const jitoBlockEngineUrls = [
  "https://mainnet.block-engine.jito.wtf",
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
