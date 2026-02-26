import type { NextConfig } from "next";

const pinataGatewayHost = (() => {
  const value = process.env.PINATA_GATEWAY_URL;
  if (!value) {
    return null;
  }
  try {
    return new URL(value).hostname;
  } catch {
    return value.replace(/^https?:\/\//, "").split("/")[0] || null;
  }
})();

const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  {
    protocol: "https",
    hostname: "gateway.pinata.cloud",
  },
];

if (pinataGatewayHost && pinataGatewayHost !== "gateway.pinata.cloud") {
  remotePatterns.push({
    protocol: "https",
    hostname: pinataGatewayHost,
  });
}

const nextConfig: NextConfig = {
  logging: {
    incomingRequests: false,
  },
  serverExternalPackages: ["@triton-one/yellowstone-grpc"],
  images: {
    remotePatterns,
  },
};

export default nextConfig;
