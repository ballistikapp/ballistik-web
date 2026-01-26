import bs58 from "bs58";
import { getEnv } from "@/lib/config/env";
import { getDefaultShyftGrpcUrl } from "@/lib/config/rpc.config";

type GrpcWaitInput = {
  signatures: string[];
  accountKeys: string[];
  timeoutMs: number;
};

type GrpcClientCtor = new (
  url: string,
  apiKey: string,
  options: object
) => { subscribe: () => Promise<unknown> };

async function loadGrpcClient() {
  try {
    const grpcModule = (await import("@triton-one/yellowstone-grpc")) as {
      default?: GrpcClientCtor;
    };
    return grpcModule.default ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSignature(value: unknown) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return bs58.encode(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return bs58.encode(Uint8Array.from(value));
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return bs58.encode(value);
  }
  if (isRecord(value) && Array.isArray(value.data)) {
    const data = value.data;
    if (data.every((item) => typeof item === "number")) {
      return bs58.encode(Uint8Array.from(data));
    }
  }
  return null;
}

function extractSignature(update: unknown) {
  if (!isRecord(update)) return null;
  const transaction = update.transaction;
  if (isRecord(transaction)) {
    const direct = normalizeSignature(transaction.signature);
    if (direct) return direct;
    const inner = transaction.transaction;
    if (isRecord(inner)) {
      const innerSignature = normalizeSignature(inner.signature);
      if (innerSignature) return innerSignature;
      const signatures = inner.signatures;
      if (Array.isArray(signatures) && signatures.length > 0) {
        const first = normalizeSignature(signatures[0]);
        if (first) return first;
      }
    }
  }
  return null;
}

export async function waitForSignaturesViaGrpc(input: GrpcWaitInput) {
  const { SHYFT_API_KEY } = getEnv();
  if (!SHYFT_API_KEY) {
    console.log("[gRPC] SHYFT_API_KEY not set, skipping gRPC");
    return null;
  }
  if (input.signatures.length === 0 || input.accountKeys.length === 0) {
    console.log("[gRPC] No signatures or account keys provided");
    return null;
  }
  const targetSignatures = new Set(input.signatures);
  const confirmed = new Set<string>();

  let stream: unknown;
  try {
    const url = getDefaultShyftGrpcUrl(process.env.VERCEL_REGION);
    console.log("[gRPC] Connecting to", url);
    const Client = await loadGrpcClient();
    if (!Client) {
      console.log("[gRPC] Failed to load yellowstone-grpc client");
      return null;
    }
    const client = new Client(url, SHYFT_API_KEY, {});
    stream = await client.subscribe();
    console.log("[gRPC] Stream connected successfully");
  } catch (error) {
    console.log(
      "[gRPC] Connection failed:",
      error instanceof Error ? error.message : String(error)
    );
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
      const signature = extractSignature(data);
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
