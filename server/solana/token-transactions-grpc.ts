import bs58 from "bs58";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { getEnv } from "@/lib/config/env";
import { getRabbitStreamUrl } from "@/lib/config/rpc.config";

type GrpcClientCtor = new (
  url: string,
  apiKey: string | undefined,
  options: object | undefined
) => { subscribe: () => Promise<GrpcStream> };

type GrpcStream = {
  on: (event: string, handler: (data?: unknown) => void) => void;
  write: (data: unknown, callback?: (err?: Error) => void) => void;
  end: () => void;
  cancel?: () => void;
};

type SignatureEntry = {
  signature: string;
  seenAt: number;
};

type TokenSubscription = {
  tokenPublicKey: string;
  accounts: string[];
  signatures: SignatureEntry[];
  signatureSet: Set<string>;
  parsedBySignature: Map<string, ParsedTransactionWithMeta | null>;
  subscribed: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePublicKey(value: unknown): string | null {
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

function normalizeSignature(value: unknown): string | null {
  return normalizePublicKey(value);
}

function normalizeAccountKey(value: unknown): string | null {
  if (isRecord(value) && "pubkey" in value) {
    return normalizePublicKey(value.pubkey);
  }
  return normalizePublicKey(value);
}

function extractSignatureFromUpdate(update: unknown): string | null {
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

function extractAccountKeysFromUpdate(update: unknown): string[] {
  if (!isRecord(update)) return [];
  const transaction = update.transaction;
  if (!isRecord(transaction)) return [];
  const inner = isRecord(transaction.transaction) ? transaction.transaction : null;
  const message = inner && isRecord(inner.message) ? inner.message : null;
  const keys =
    (message && isRecord(message) ? message.accountKeys : null) ??
    (isRecord(transaction.message) ? transaction.message.accountKeys : null) ??
    (isRecord(transaction.transaction) ? transaction.transaction.accountKeys : null);
  if (!Array.isArray(keys)) return [];
  return keys
    .map((key) => normalizeAccountKey(key))
    .filter((key): key is string => Boolean(key));
}

async function loadGrpcClient(): Promise<GrpcClientCtor | null> {
  try {
    const grpcModule = (await import("@triton-one/yellowstone-grpc")) as {
      default?: GrpcClientCtor;
    };
    return grpcModule.default ?? null;
  } catch {
    return null;
  }
}

class TokenTransactionsGrpcManager {
  private stream: GrpcStream | null = null;
  private connected = false;
  private reconnecting = false;
  private enabled = false;
  private lastError: string | null = null;

  private tokenSubscriptions = new Map<string, TokenSubscription>();
  private allSubscribedAccounts = new Set<string>();
  private accountToTokens = new Map<string, Set<string>>();

  async connect(): Promise<boolean> {
    const { SHYFT_API_KEY } = getEnv();
    if (!SHYFT_API_KEY) {
      console.log("[TokenGrpc] SHYFT_API_KEY not set, gRPC disabled");
      this.enabled = false;
      this.lastError = "SHYFT_API_KEY not set";
      return false;
    }
    this.enabled = true;

    try {
      const url = getRabbitStreamUrl(process.env.VERCEL_REGION);
      console.log("[TokenGrpc] Connecting to RabbitStream:", url);

      const Client = await loadGrpcClient();
      if (!Client) {
        console.log("[TokenGrpc] Failed to load yellowstone-grpc client");
        this.lastError = "Failed to load yellowstone-grpc client";
        return false;
      }

      const client = new Client(url, SHYFT_API_KEY, undefined);
      this.stream = await client.subscribe();
      this.setupStreamHandlers();
      this.connected = true;
      this.lastError = null;
      console.log("[TokenGrpc] Connected successfully");
      return true;
    } catch (error) {
      console.error(
        "[TokenGrpc] Connection failed:",
        error instanceof Error ? error.message : String(error)
      );
      this.lastError = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect();
      return false;
    }
  }

  private setupStreamHandlers() {
    if (!this.stream) return;
    this.stream.on("data", (data: unknown) => this.handleUpdate(data));
    this.stream.on("error", (error: unknown) => {
      console.error(
        "[TokenGrpc] Stream error:",
        error instanceof Error ? error.message : String(error)
      );
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect();
    });
    this.stream.on("end", () => {
      console.log("[TokenGrpc] Stream ended");
      this.connected = false;
      this.lastError = "Stream ended";
      this.scheduleReconnect();
    });
  }

  private handleUpdate(data: unknown) {
    if (!isRecord(data)) return;
    if (!data.transaction) return;
    const signature = extractSignatureFromUpdate(data);
    if (!signature) return;
    const accountKeys = extractAccountKeysFromUpdate(data);
    if (accountKeys.length === 0) return;
    const tokenMatches = new Set<string>();
    accountKeys.forEach((key) => {
      const tokens = this.accountToTokens.get(key);
      if (tokens) {
        tokens.forEach((token) => tokenMatches.add(token));
      }
    });
    if (tokenMatches.size === 0) return;
    tokenMatches.forEach((tokenPublicKey) => {
      this.addSignature(tokenPublicKey, signature);
    });
  }

  private addSignature(tokenPublicKey: string, signature: string) {
    const state = this.tokenSubscriptions.get(tokenPublicKey);
    if (!state) return;
    if (state.signatureSet.has(signature)) return;
    state.signatureSet.add(signature);
    state.signatures.unshift({ signature, seenAt: Date.now() });
    const maxEntries = 250;
    if (state.signatures.length > maxEntries) {
      const removed = state.signatures.splice(maxEntries);
      removed.forEach((entry) => {
        state.signatureSet.delete(entry.signature);
        state.parsedBySignature.delete(entry.signature);
      });
    }
  }

  async subscribeToToken(
    tokenPublicKey: string,
    accounts: string[]
  ): Promise<boolean> {
    const existing = this.tokenSubscriptions.get(tokenPublicKey);
    if (!existing) {
      this.tokenSubscriptions.set(tokenPublicKey, {
        tokenPublicKey,
        accounts: [],
        signatures: [],
        signatureSet: new Set(),
        parsedBySignature: new Map(),
        subscribed: false,
      });
    }
    const state = this.tokenSubscriptions.get(tokenPublicKey);
    if (!state) return false;

    let shouldResubscribe = !state.subscribed;
    accounts.forEach((account) => {
      if (!state.accounts.includes(account)) {
        state.accounts.push(account);
        shouldResubscribe = true;
      }
      if (!this.allSubscribedAccounts.has(account)) {
        this.allSubscribedAccounts.add(account);
        shouldResubscribe = true;
      }
      const tokens = this.accountToTokens.get(account) ?? new Set<string>();
      tokens.add(tokenPublicKey);
      this.accountToTokens.set(account, tokens);
    });

    if (!this.connected || !this.stream) {
      const connected = await this.connect();
      if (!connected || !this.stream) return false;
    }

    if (!shouldResubscribe) {
      return true;
    }

    const allAccounts = Array.from(this.allSubscribedAccounts);
    if (allAccounts.length === 0) return false;

    try {
      await new Promise<void>((resolve, reject) => {
        this.stream?.write(
          {
            accounts: {
              tokenMonitor: {
                account: allAccounts,
                owner: [],
                filters: [],
              },
            },
            transactions: {
              tokenMonitor: {
                vote: false,
                failed: false,
                accountInclude: allAccounts,
                accountExclude: [],
                accountRequired: [],
              },
            },
            commitment: 1,
          },
          (err?: Error) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      state.subscribed = true;
      return true;
    } catch (error) {
      console.error(
        "[TokenGrpc] Subscribe failed:",
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  getState(tokenPublicKey: string) {
    return this.tokenSubscriptions.get(tokenPublicKey) ?? null;
  }

  getStatus() {
    return {
      connected: this.connected,
      enabled: this.enabled,
      lastError: this.lastError,
    };
  }

  private scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.connected = false;

    setTimeout(async () => {
      this.reconnecting = false;
      const success = await this.connect();
      if (success && this.stream) {
        const allAccounts = Array.from(this.allSubscribedAccounts);
        if (allAccounts.length === 0) return;
        try {
          await new Promise<void>((resolve, reject) => {
            this.stream?.write(
              {
                accounts: {
                  tokenMonitor: {
                    account: allAccounts,
                    owner: [],
                    filters: [],
                  },
                },
                transactions: {
                  tokenMonitor: {
                    vote: false,
                    failed: false,
                    accountInclude: allAccounts,
                    accountExclude: [],
                    accountRequired: [],
                  },
                },
                commitment: 1,
              },
              (err?: Error) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        } catch (error) {
          console.error(
            "[TokenGrpc] Re-subscribe failed:",
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }, 5000);
  }
}

const globalForTokenGrpc = globalThis as unknown as {
  tokenTransactionsGrpc?: TokenTransactionsGrpcManager;
};

export const tokenTransactionsGrpc =
  globalForTokenGrpc.tokenTransactionsGrpc ?? new TokenTransactionsGrpcManager();

if (process.env.NODE_ENV !== "production") {
  globalForTokenGrpc.tokenTransactionsGrpc = tokenTransactionsGrpc;
}
