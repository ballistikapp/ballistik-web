const shyftGrpcRegions = [
  "grpc.ams.shyft.to",
  "grpc.eu.shyft.to",
  "grpc.fra.shyft.to",
  "grpc.ny.shyft.to",
  "grpc.sgp.shyft.to",
  "grpc.us.shyft.to",
  "grpc.va.shyft.to",
] as const;

const vercelRegionMap: Record<string, (typeof shyftGrpcRegions)[number]> = {
  ams: "grpc.ams.shyft.to",
  dub1: "grpc.eu.shyft.to",
  fra1: "grpc.fra.shyft.to",
  iad1: "grpc.va.shyft.to",
  nyc1: "grpc.ny.shyft.to",
  sfo1: "grpc.us.shyft.to",
  sin1: "grpc.sgp.shyft.to",
};

export const rpcConfig = {
  shyftGrpcRegions,
  tuning: {
    solBalanceBatchSize: 100,
    tokenBalanceConcurrency: 8,
    holdingBalanceConcurrency: 8,
  },
};

export function getDefaultShyftGrpcUrl(region?: string) {
  if (region) {
    const normalized = region.toLowerCase();
    if (normalized in vercelRegionMap) {
      return `grpc+tls://${vercelRegionMap[normalized]}:443`;
    }
  }
  return "grpc+tls://grpc.us.shyft.to:443";
}
