import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { getEnv } from "@/lib/config/env";
import { getRabbitStreamUrl } from "@/lib/config/rpc.config";

type BalanceUpdate = { lamports: number; slot: number };
type TokenUpdate = { amount: bigint; slot: number };

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

type SessionSubscription = {
  wallets: string[];
  mint: string;
  bondingCurve: string;
};

type PendingConfirmation = {
  resolve: (confirmed: boolean) => void;
  timeout: NodeJS.Timeout;
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
  return null;
}

function normalizeSignature(value: unknown): string | null {
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

function extractSignatureFromTx(update: unknown): string | null {
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

class VolumeBotGrpcManager {
  private stream: GrpcStream | null = null;
  private connected = false;
  private reconnecting = false;
  private apiKey: string | null = null;

  private solBalances = new Map<string, BalanceUpdate>();
  private tokenBalances = new Map<string, TokenUpdate>();
  private bondingCurves = new Map<string, unknown>();

  private confirmedTxs = new Set<string>();
  private pendingTxs = new Map<string, PendingConfirmation>();

  private sessionSubscriptions = new Map<string, SessionSubscription>();
  private allSubscribedAccounts = new Set<string>();

  async connect(): Promise<boolean> {
    const { SHYFT_API_KEY } = getEnv();
    if (!SHYFT_API_KEY) {
      console.log("[VolumeBotGrpc] SHYFT_API_KEY not set, gRPC disabled");
      return false;
    }
    this.apiKey = SHYFT_API_KEY;

    try {
      const url = getRabbitStreamUrl(process.env.VERCEL_REGION);
      console.log("[VolumeBotGrpc] Connecting to RabbitStream:", url);

      const Client = await loadGrpcClient();
      if (!Client) {
        console.log("[VolumeBotGrpc] Failed to load yellowstone-grpc client");
        return false;
      }

      const client = new Client(url, SHYFT_API_KEY, undefined);
      this.stream = await client.subscribe();
      this.setupStreamHandlers();
      this.connected = true;
      console.log("[VolumeBotGrpc] Connected successfully");
      return true;
    } catch (error) {
      console.error(
        "[VolumeBotGrpc] Connection failed:",
        error instanceof Error ? error.message : String(error)
      );
      this.scheduleReconnect();
      return false;
    }
  }

  private setupStreamHandlers() {
    if (!this.stream) return;

    this.stream.on("data", (data: unknown) => this.handleUpdate(data));
    this.stream.on("error", (error: unknown) => {
      console.error(
        "[VolumeBotGrpc] Stream error:",
        error instanceof Error ? error.message : String(error)
      );
      this.connected = false;
      this.scheduleReconnect();
    });
    this.stream.on("end", () => {
      console.log("[VolumeBotGrpc] Stream ended");
      this.connected = false;
      this.scheduleReconnect();
    });
  }

  private handleUpdate(data: unknown) {
    if (!isRecord(data)) return;

    if (data.account && isRecord(data.account)) {
      this.handleAccountUpdate(data.account);
    }

    if (data.transaction) {
      this.handleTransactionUpdate(data);
    }
  }

  private handleAccountUpdate(accountUpdate: Record<string, unknown>) {
    const account = accountUpdate.account;
    if (!isRecord(account)) return;

    const pubkeyRaw = account.pubkey;
    const pubkey = normalizePublicKey(pubkeyRaw);
    if (!pubkey) return;

    const lamports = account.lamports;
    const slot =
      typeof accountUpdate.slot === "number"
        ? accountUpdate.slot
        : typeof accountUpdate.slot === "bigint"
          ? Number(accountUpdate.slot)
          : 0;

    if (typeof lamports === "number" || typeof lamports === "bigint") {
      const existingBalance = this.solBalances.get(pubkey);
      if (!existingBalance || existingBalance.slot < slot) {
        this.solBalances.set(pubkey, {
          lamports: Number(lamports),
          slot,
        });
      }
    }

    const accountData = account.data;
    if (accountData && isRecord(accountData)) {
      const parsed = accountData.parsed;
      if (isRecord(parsed)) {
        const info = parsed.info;
        if (isRecord(info)) {
          const tokenAmount = info.tokenAmount;
          if (isRecord(tokenAmount)) {
            const amount = tokenAmount.amount;
            const mint = info.mint;
            if (typeof amount === "string" && typeof mint === "string") {
              const owner = info.owner;
              if (typeof owner === "string") {
                const key = `${owner}:${mint}`;
                const existingToken = this.tokenBalances.get(key);
                if (!existingToken || existingToken.slot < slot) {
                  this.tokenBalances.set(key, {
                    amount: BigInt(amount),
                    slot,
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  private handleTransactionUpdate(data: unknown) {
    const signature = extractSignatureFromTx(data);
    if (!signature) return;

    this.confirmedTxs.add(signature);

    const pending = this.pendingTxs.get(signature);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(true);
      this.pendingTxs.delete(signature);
    }
  }

  async subscribeToSession(
    sessionId: string,
    walletPubkeys: string[],
    mintPubkey: string,
    bondingCurvePubkey: string
  ): Promise<boolean> {
    if (!this.connected || !this.stream) {
      console.log("[VolumeBotGrpc] Not connected, cannot subscribe");
      return false;
    }

    this.sessionSubscriptions.set(sessionId, {
      wallets: walletPubkeys,
      mint: mintPubkey,
      bondingCurve: bondingCurvePubkey,
    });

    const accountsToAdd = [bondingCurvePubkey, ...walletPubkeys].filter(
      (acc) => !this.allSubscribedAccounts.has(acc)
    );

    if (accountsToAdd.length === 0) {
      console.log(
        `[VolumeBotGrpc] Session ${sessionId} - all accounts already subscribed`
      );
      return true;
    }

    accountsToAdd.forEach((acc) => this.allSubscribedAccounts.add(acc));

    const allAccounts = Array.from(this.allSubscribedAccounts);

    try {
      await new Promise<void>((resolve, reject) => {
        this.stream?.write(
          {
            accounts: {
              volumeBot: {
                account: allAccounts,
                owner: [],
                filters: [],
              },
            },
            transactions: {
              volumeBot: {
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

      console.log(
        `[VolumeBotGrpc] Subscribed to session ${sessionId} with ${walletPubkeys.length} wallets`
      );
      return true;
    } catch (error) {
      console.error(
        "[VolumeBotGrpc] Subscribe failed:",
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  getSolBalance(pubkey: string): number | null {
    return this.solBalances.get(pubkey)?.lamports ?? null;
  }

  getTokenBalance(walletPubkey: string, mintPubkey: string): bigint | null {
    const key = `${walletPubkey}:${mintPubkey}`;
    return this.tokenBalances.get(key)?.amount ?? null;
  }

  getBondingCurveState(pubkey: string): unknown | null {
    return this.bondingCurves.get(pubkey) ?? null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async waitForConfirmation(
    signature: string,
    timeoutMs = 30000
  ): Promise<boolean> {
    if (this.confirmedTxs.has(signature)) return true;
    if (!this.connected) return false;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingTxs.delete(signature);
        resolve(false);
      }, timeoutMs);

      this.pendingTxs.set(signature, { resolve, timeout });
    });
  }

  clearCachesForSession(sessionId: string) {
    const sub = this.sessionSubscriptions.get(sessionId);
    if (!sub) return;

    sub.wallets.forEach((w) => {
      this.solBalances.delete(w);
      this.tokenBalances.delete(`${w}:${sub.mint}`);
    });
    this.bondingCurves.delete(sub.bondingCurve);
  }

  unsubscribeFromSession(sessionId: string) {
    this.clearCachesForSession(sessionId);
    this.sessionSubscriptions.delete(sessionId);

    this.rebuildSubscribedAccounts();
  }

  private rebuildSubscribedAccounts() {
    this.allSubscribedAccounts.clear();
    for (const sub of this.sessionSubscriptions.values()) {
      sub.wallets.forEach((w) => this.allSubscribedAccounts.add(w));
      this.allSubscribedAccounts.add(sub.bondingCurve);
    }
  }

  private scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.connected = false;

    console.log("[VolumeBotGrpc] Scheduling reconnect in 5 seconds...");

    setTimeout(async () => {
      this.reconnecting = false;
      const success = await this.connect();
      if (success && this.sessionSubscriptions.size > 0) {
        console.log("[VolumeBotGrpc] Reconnected, re-subscribing to sessions");
        const allAccounts = Array.from(this.allSubscribedAccounts);
        if (allAccounts.length > 0 && this.stream) {
          try {
            await new Promise<void>((resolve, reject) => {
              this.stream?.write(
                {
                  accounts: {
                    volumeBot: {
                      account: allAccounts,
                      owner: [],
                      filters: [],
                    },
                  },
                  transactions: {
                    volumeBot: {
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
            console.log(
              `[VolumeBotGrpc] Re-subscribed to ${allAccounts.length} accounts`
            );
          } catch (error) {
            console.error(
              "[VolumeBotGrpc] Re-subscribe failed:",
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }
    }, 5000);
  }

  shutdown() {
    this.connected = false;
    this.reconnecting = true;
    if (this.stream) {
      try {
        this.stream.end();
      } catch {
        // Ignore errors on shutdown
      }
      this.stream = null;
    }
    this.solBalances.clear();
    this.tokenBalances.clear();
    this.bondingCurves.clear();
    this.confirmedTxs.clear();
    this.pendingTxs.forEach((p) => clearTimeout(p.timeout));
    this.pendingTxs.clear();
    this.sessionSubscriptions.clear();
    this.allSubscribedAccounts.clear();
  }
}

const globalForGrpc = globalThis as unknown as {
  volumeBotGrpc?: VolumeBotGrpcManager;
};

export const volumeBotGrpc =
  globalForGrpc.volumeBotGrpc ?? new VolumeBotGrpcManager();

if (process.env.NODE_ENV !== "production") {
  globalForGrpc.volumeBotGrpc = volumeBotGrpc;
}
