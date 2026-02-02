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

const rabbitStreamEndpoints = {
  ams: "https://rabbitstream.ams.shyft.to/",
  va: "https://rabbitstream.va.shyft.to/",
  ny: "https://rabbitstream.ny.shyft.to/",
  fra: "https://rabbitstream.fra.shyft.to/",
} as const;

const vercelToRabbitStreamMap: Record<
  string,
  keyof typeof rabbitStreamEndpoints
> = {
  ams: "ams",
  dub1: "fra",
  fra1: "fra",
  iad1: "va",
  nyc1: "ny",
  sfo1: "va",
  sin1: "va",
};

export const rpcConfig = {
  shyftGrpcRegions,
  rabbitStreamEndpoints,
  tuning: {
    solBalanceBatchSize: 100,
    tokenBalanceConcurrency: 5,
    holdingBalanceConcurrency: 5,
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

export function getRabbitStreamUrl(region?: string) {
  if (region) {
    const normalized = region.toLowerCase();
    if (normalized in vercelToRabbitStreamMap) {
      const key = vercelToRabbitStreamMap[normalized];
      return rabbitStreamEndpoints[key];
    }
    if (normalized in rabbitStreamEndpoints) {
      return rabbitStreamEndpoints[normalized as keyof typeof rabbitStreamEndpoints];
    }
  }
  return rabbitStreamEndpoints.va;
}
