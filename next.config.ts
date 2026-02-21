import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    incomingRequests: false,
  },
  serverExternalPackages: ["@triton-one/yellowstone-grpc"],
};

export default nextConfig;
