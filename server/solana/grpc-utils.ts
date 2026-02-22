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

export type ExtractResult<T> =
  | { status: "ok"; value: T }
  | { status: "malformed" | "unsupported"; reason: string };

function ok<T>(value: T): ExtractResult<T> {
  return { status: "ok", value };
}

function malformed<T>(reason: string): ExtractResult<T> {
  return { status: "malformed", reason };
}

function unsupported<T>(reason: string): ExtractResult<T> {
  return { status: "unsupported", reason };
}

export function extractSignatureFromUpdateResult(
  update: unknown
): ExtractResult<string> {
  if (!isRecord(update)) return malformed("update is not an object");
  const transaction = update.transaction;
  if (!isRecord(transaction)) return unsupported("transaction payload missing");

  const direct = normalizeSignature(transaction.signature);
  if (direct) return ok(direct);

  const inner = transaction.transaction;
  if (isRecord(inner)) {
    const innerSignature = normalizeSignature(inner.signature);
    if (innerSignature) return ok(innerSignature);
    const signatures = inner.signatures;
    if (Array.isArray(signatures) && signatures.length > 0) {
      const first = normalizeSignature(signatures[0]);
      if (first) return ok(first);
    }
  }

  return malformed("signature not found in transaction payload");
}

export function extractSignatureFromUpdate(update: unknown): string | null {
  const result = extractSignatureFromUpdateResult(update);
  return result.status === "ok" ? result.value : null;
}

export function extractAccountKeysFromUpdateResult(
  update: unknown
): ExtractResult<string[]> {
  if (!isRecord(update)) return malformed("update is not an object");
  const transaction = update.transaction;
  if (!isRecord(transaction)) return unsupported("transaction payload missing");
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
  if (!Array.isArray(keys)) return malformed("account keys missing");

  const normalized = keys
    .map((key) => normalizeAccountKey(key))
    .filter((key): key is string => Boolean(key));
  return ok(normalized);
}

export function extractAccountKeysFromUpdate(update: unknown): string[] {
  const result = extractAccountKeysFromUpdateResult(update);
  return result.status === "ok" ? result.value : [];
}

function normalizeBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return Uint8Array.from(value);
  }
  if (
    Array.isArray(value) &&
    value.length >= 1 &&
    typeof value[0] === "string"
  ) {
    try {
      return new Uint8Array(Buffer.from(value[0], "base64"));
    } catch {
      return null;
    }
  }
  if (isRecord(value) && "data" in value) {
    return normalizeBytes(value.data);
  }
  return null;
}

function readU64Le(bytes: Uint8Array, offset: number): bigint {
  let out = BigInt(0);
  for (let i = 0; i < 8; i += 1) {
    out |= BigInt(bytes[offset + i] ?? 0) << BigInt(i * 8);
  }
  return out;
}

export type TokenAccountFields = {
  mint: string;
  owner: string;
  amount: bigint;
};

export function decodeTokenAccountData(
  accountData: unknown
): ExtractResult<TokenAccountFields> {
  const bytes = normalizeBytes(accountData);
  if (!bytes) return unsupported("account data is not decodable bytes");
  if (bytes.length < 72) return malformed("account data shorter than token layout");

  const mintBytes = bytes.slice(0, 32);
  const ownerBytes = bytes.slice(32, 64);
  const amount = readU64Le(bytes, 64);
  const mint = bs58.encode(mintBytes);
  const owner = bs58.encode(ownerBytes);
  return ok({ mint, owner, amount });
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
    const grpcModule = await import("@triton-one/yellowstone-grpc");
    const mod = grpcModule as Record<string, unknown>;
    const defaultExport = mod.default as Record<string, unknown> | undefined;
    const Client =
      (typeof defaultExport === "function" && defaultExport) ||
      (typeof defaultExport?.default === "function" &&
        defaultExport.default) ||
      null;
    if (!Client) {
      console.error(
        "[grpc-utils] yellowstone-grpc loaded but Client constructor not found. " +
        `default type: ${typeof defaultExport}, ` +
        `default.default type: ${typeof defaultExport?.default}`
      );
    }
    return Client as GrpcClientCtor | null;
  } catch (error) {
    console.error(
      "[grpc-utils] Failed to import @triton-one/yellowstone-grpc:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
