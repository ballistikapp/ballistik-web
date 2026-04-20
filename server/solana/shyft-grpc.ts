import { getEnv } from "@/lib/config/env";
import { getDefaultShyftGrpcUrl } from "@/lib/config/rpc.config";
import { logger } from "@/lib/logger";
import {
  isRecord,
  extractSignatureFromUpdate,
  loadGrpcClient,
} from "./grpc-utils";

type GrpcWaitInput = {
  signatures: string[];
  accountKeys: string[];
  timeoutMs: number;
};

const log = logger.child({ service: "shyft-grpc" });

export async function waitForSignaturesViaGrpc(input: GrpcWaitInput) {
  const env = getEnv();
  const grpcToken = env.SHYFT_GRPC_TOKEN?.trim() ?? "";
  const { GRPC_ACCESS_MODE } = env;
  if (GRPC_ACCESS_MODE === "off") {
    log.info("GRPC_ACCESS_MODE=off, skipping gRPC");
    return null;
  }
  if (!grpcToken) {
    log.info("SHYFT_GRPC_TOKEN not set, skipping gRPC");
    return null;
  }
  if (input.signatures.length === 0 || input.accountKeys.length === 0) {
    log.info("No signatures or account keys provided");
    return null;
  }
  const targetSignatures = new Set(input.signatures);
  const confirmed = new Set<string>();

  let stream: unknown;
  try {
    const url = getDefaultShyftGrpcUrl(process.env.VERCEL_REGION);
    log.info("Connecting to gRPC stream", { url });
    const Client = await loadGrpcClient();
    if (!Client) {
      log.warn("Failed to load yellowstone-grpc client");
      return null;
    }
    const client = new Client(url, grpcToken, {});
    stream = await client.subscribe();
    log.info("gRPC stream connected successfully");
  } catch (error) {
    log.warn("gRPC connection failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  return await new Promise<Set<string> | null>((resolve) => {
    let finished = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const complete = (result: Set<string> | null) => {
      if (finished) return;
      finished = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (isRecord(stream)) {
        const end = stream.end;
        const cancel = stream.cancel;
        if (typeof end === "function") {
          end.call(stream);
        } else if (typeof cancel === "function") {
          cancel.call(stream);
        }
      }
      resolve(result);
    };

    const onData = (data?: unknown) => {
      const signature = extractSignatureFromUpdate(data);
      if (!signature || !targetSignatures.has(signature)) return;
      confirmed.add(signature);
      if (signature === input.signatures[0]) {
        complete(new Set(confirmed));
      }
    };

    if (isRecord(stream) && typeof stream.on === "function") {
      stream.on("data", onData);
      stream.on("error", () => complete(null));
      stream.on("end", () =>
        complete(confirmed.size > 0 ? new Set(confirmed) : null)
      );
    }

    if (isRecord(stream) && typeof stream.write === "function") {
      stream.write({
        commitment: "confirmed",
        transactions: {
          accountInclude: input.accountKeys,
          accountExclude: [],
          accountRequired: [],
        },
      });
    }

    timeoutId = setTimeout(() => {
      complete(confirmed.size > 0 ? new Set(confirmed) : null);
    }, input.timeoutMs);
  });
}
