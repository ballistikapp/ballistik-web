import bs58 from "bs58";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizePublicKey(value: unknown): string | null {
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

export function normalizeSignature(value: unknown): string | null {
  return normalizePublicKey(value);
}

export function normalizeAccountKey(value: unknown): string | null {
  if (isRecord(value) && "pubkey" in value) {
    return normalizePublicKey(value.pubkey);
  }
  return normalizePublicKey(value);
}

export function extractSignatureFromUpdate(update: unknown): string | null {
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

export function extractAccountKeysFromUpdate(update: unknown): string[] {
  if (!isRecord(update)) return [];
  const transaction = update.transaction;
  if (!isRecord(transaction)) return [];
  const inner = isRecord(transaction.transaction)
    ? transaction.transaction
    : null;
  const message = inner && isRecord(inner.message) ? inner.message : null;
  const keys =
    (message && isRecord(message) ? message.accountKeys : null) ??
    (isRecord(transaction.message) ? transaction.message.accountKeys : null) ??
    (isRecord(transaction.transaction)
      ? transaction.transaction.accountKeys
      : null);
  if (!Array.isArray(keys)) return [];
  return keys
    .map((key) => normalizeAccountKey(key))
    .filter((key): key is string => Boolean(key));
}

export type GrpcClientCtor = new (
  url: string,
  apiKey: string | undefined,
  options: object | undefined
) => { subscribe: () => Promise<GrpcStream> };

export type GrpcStream = {
  on: (event: string, handler: (data?: unknown) => void) => void;
  write: (data: unknown, callback?: (err?: Error) => void) => void;
  end: () => void;
  cancel?: () => void;
};

export async function loadGrpcClient(): Promise<GrpcClientCtor | null> {
  try {
    const grpcModule = (await import("@triton-one/yellowstone-grpc")) as {
      default?: GrpcClientCtor;
    };
    return grpcModule.default ?? null;
  } catch {
    return null;
  }
}
