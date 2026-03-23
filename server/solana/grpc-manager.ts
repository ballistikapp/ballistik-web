import { getEnv } from "@/lib/config/env";
import { getRabbitStreamUrl, getDefaultShyftGrpcUrl } from "@/lib/config/rpc.config";
import {
  isRecord,
  normalizePublicKey,
  extractSignatureFromUpdateResult,
  extractAccountKeysFromUpdateResult,
  decodeTokenAccountData,
  loadGrpcClient,
  type GrpcStream,
} from "./grpc-utils";
import { logger } from "@/lib/logger";

const log = logger.child({ service: "grpc" });

export type AccountUpdate = {
  pubkey: string;
  lamports: number;
  slot: number;
  owner?: string;
  mint?: string;
  tokenAmount?: bigint;
};

export type TransactionUpdate = {
  signature: string;
  accountKeys: string[];
  slot: number;
};

type Listener<T> = (data: T) => void;

type Subscription = {
  id: string;
  accounts: string[];
};

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

class GrpcManager {
  private stream: GrpcStream | null = null;
  private connected = false;
  private reconnecting = false;
  private apiKey: string | null = null;
  private lastError: string | null = null;
  private endpointType: "rabbitstream" | "yellowstone" = "rabbitstream";

  private subscriptions = new Map<string, Subscription>();
  private allSubscribedAccounts = new Set<string>();

  private accountListeners = new Set<Listener<AccountUpdate>>();
  private transactionListeners = new Set<Listener<TransactionUpdate>>();
  private lastEventAt: string | null = null;
  private lastWriteFailureAt: string | null = null;
  private metrics = {
    streamEventsReceived: 0,
    accountEventsReceived: 0,
    transactionEventsReceived: 0,
    accountEventsDecoded: 0,
    transactionEventsDecoded: 0,
    droppedMalformed: 0,
    droppedUnsupported: 0,
    subscriptionWriteSuccess: 0,
    subscriptionWriteFailure: 0,
    dbWriteSuccess: 0,
    dbWriteFailure: 0,
  };

  async connect(
    endpoint?: "rabbitstream" | "yellowstone"
  ): Promise<boolean> {
    const { SHYFT_GRPC_TOKEN, GRPC_ACCESS_MODE } = getEnv();
    if (GRPC_ACCESS_MODE === "off") {
      log.warn("GRPC_ACCESS_MODE=off, gRPC disabled");
      this.lastError = "GRPC_ACCESS_MODE=off";
      return false;
    }
    if (!SHYFT_GRPC_TOKEN) {
      log.warn("SHYFT_GRPC_TOKEN not set, gRPC disabled");
      this.lastError = "SHYFT_GRPC_TOKEN not set";
      return false;
    }
    this.apiKey = SHYFT_GRPC_TOKEN;
    this.endpointType = endpoint ?? "rabbitstream";

    try {
      const url =
        this.endpointType === "rabbitstream"
          ? getRabbitStreamUrl(process.env.VERCEL_REGION)
          : getDefaultShyftGrpcUrl(process.env.VERCEL_REGION);
      log.info("Connecting", { endpoint: this.endpointType, url });

      const Client = await loadGrpcClient();
      if (!Client) {
        log.error("Failed to load yellowstone-grpc client");
        this.lastError = "Failed to load yellowstone-grpc client";
        return false;
      }

      const client = new Client(url, SHYFT_GRPC_TOKEN, undefined);
      this.stream = await client.subscribe();
      this.setupStreamHandlers();
      this.connected = true;
      this.lastError = null;
      log.info("Connected successfully", { endpoint: this.endpointType });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("Connection failed", { error: message, endpoint: this.endpointType });
      this.lastError = message;
      this.scheduleReconnect();
      return false;
    }
  }

  getEndpointType(): "rabbitstream" | "yellowstone" {
    return this.endpointType;
  }

  private setupStreamHandlers() {
    if (!this.stream) return;

    this.stream.on("data", (data: unknown) => this.handleUpdate(data));
    this.stream.on("error", (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error("Stream error", { error: message });
      this.connected = false;
      this.lastError = message;
      this.scheduleReconnect();
    });
    this.stream.on("end", () => {
      log.warn("Stream ended unexpectedly");
      this.connected = false;
      this.lastError = "Stream ended";
      this.scheduleReconnect();
    });
  }

  private handleUpdate(data: unknown) {
    this.metrics.streamEventsReceived += 1;
    this.lastEventAt = new Date().toISOString();
    if (!isRecord(data)) {
      this.metrics.droppedMalformed += 1;
      return;
    }

    if (data.account && isRecord(data.account)) {
      this.metrics.accountEventsReceived += 1;
      this.handleAccountUpdate(data.account);
    }

    if (data.transaction) {
      this.metrics.transactionEventsReceived += 1;
      this.handleTransactionUpdate(data);
    }
  }

  private handleAccountUpdate(accountUpdate: Record<string, unknown>) {
    const account = isRecord(accountUpdate.account)
      ? accountUpdate.account
      : accountUpdate;
    if (!isRecord(account)) {
      this.metrics.droppedMalformed += 1;
      return;
    }

    const pubkey = normalizePublicKey(account.pubkey);
    if (!pubkey) {
      this.metrics.droppedMalformed += 1;
      return;
    }

    const slot =
      typeof accountUpdate.slot === "number"
        ? accountUpdate.slot
        : typeof accountUpdate.slot === "bigint"
          ? Number(accountUpdate.slot)
          : 0;

    const lamports =
      typeof account.lamports === "number"
        ? account.lamports
        : typeof account.lamports === "bigint"
          ? Number(account.lamports)
          : 0;

    const update: AccountUpdate = { pubkey, lamports, slot };

    const accountData = account.data;
    const accountOwnerProgram = normalizePublicKey(account.owner);
    let parsedTokenFields = false;
    if (accountData && isRecord(accountData)) {
      const parsed = accountData.parsed;
      if (isRecord(parsed)) {
        const info = parsed.info;
        if (isRecord(info)) {
          const tokenAmount = info.tokenAmount;
          if (isRecord(tokenAmount)) {
            const amount = tokenAmount.amount;
            const mint = info.mint;
            const owner = info.owner;
            if (
              typeof amount === "string" &&
              typeof mint === "string" &&
              typeof owner === "string"
            ) {
              update.owner = owner;
              update.mint = mint;
              update.tokenAmount = BigInt(amount);
              parsedTokenFields = true;
            }
          }
        }
      }
    }

    if (!parsedTokenFields && accountOwnerProgram === TOKEN_PROGRAM_ID) {
      const decoded = decodeTokenAccountData(accountData);
      if (decoded.status === "ok") {
        update.owner = decoded.value.owner;
        update.mint = decoded.value.mint;
        update.tokenAmount = decoded.value.amount;
      } else if (decoded.status === "malformed") {
        this.metrics.droppedMalformed += 1;
      } else {
        this.metrics.droppedUnsupported += 1;
      }
    }

    this.metrics.accountEventsDecoded += 1;
    this.accountListeners.forEach((listener) => {
      try {
        listener(update);
      } catch {
        // ignore listener errors
      }
    });
  }

  private handleTransactionUpdate(data: unknown) {
    const signatureResult = extractSignatureFromUpdateResult(data);
    if (signatureResult.status !== "ok") {
      if (signatureResult.status === "malformed") {
        this.metrics.droppedMalformed += 1;
      } else {
        this.metrics.droppedUnsupported += 1;
      }
      return;
    }
    const signature = signatureResult.value;

    const accountKeysResult = extractAccountKeysFromUpdateResult(data);
    const accountKeys =
      accountKeysResult.status === "ok" ? accountKeysResult.value : [];
    if (accountKeysResult.status !== "ok") {
      if (accountKeysResult.status === "malformed") {
        this.metrics.droppedMalformed += 1;
      } else {
        this.metrics.droppedUnsupported += 1;
      }
    }
    const slot = isRecord(data) && typeof data.slot === "number" ? data.slot : 0;

    const update: TransactionUpdate = { signature, accountKeys, slot };

    this.metrics.transactionEventsDecoded += 1;
    this.transactionListeners.forEach((listener) => {
      try {
        listener(update);
      } catch {
        // ignore listener errors
      }
    });
  }

  async subscribe(
    subscriptionId: string,
    accounts: string[]
  ): Promise<boolean> {
    const existing = this.subscriptions.get(subscriptionId);
    const existingAccounts = new Set(existing?.accounts ?? []);
    const newAccounts = accounts.filter((a) => !existingAccounts.has(a));

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      accounts: [...(existing?.accounts ?? []), ...newAccounts],
    });

    newAccounts.forEach((a) => this.allSubscribedAccounts.add(a));

    if (newAccounts.length === 0 && existing) {
      return true;
    }

    if (!this.connected || !this.stream) {
      const connected = await this.connect();
      if (!connected || !this.stream) return false;
    }

    return this.writeSubscription();
  }

  unsubscribe(subscriptionId: string) {
    this.subscriptions.delete(subscriptionId);
    this.rebuildSubscribedAccounts();
  }

  private rebuildSubscribedAccounts() {
    this.allSubscribedAccounts.clear();
    for (const sub of this.subscriptions.values()) {
      sub.accounts.forEach((a) => this.allSubscribedAccounts.add(a));
    }
  }

  private async writeSubscription(): Promise<boolean> {
    if (!this.stream) return false;

    const allAccounts = Array.from(this.allSubscribedAccounts);
    if (allAccounts.length === 0) return true;

    try {
      await new Promise<void>((resolve, reject) => {
        this.stream?.write(
          {
            accounts: {
              unified: {
                account: allAccounts,
                owner: [],
                filters: [],
              },
            },
            slots: {},
            transactions: {
              unified: {
                vote: false,
                failed: false,
                accountInclude: allAccounts,
                accountExclude: [],
                accountRequired: [],
              },
            },
            transactionsStatus: {},
            blocks: {},
            blocksMeta: {},
            entry: {},
            commitment: 1,
            accountsDataSlice: [],
            ping: undefined,
          },
          (err?: Error) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
      log.info("Subscribed", { accounts: allAccounts.length });
      this.metrics.subscriptionWriteSuccess += 1;
      return true;
    } catch (error) {
      log.error("Subscribe write failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.metrics.subscriptionWriteFailure += 1;
      return false;
    }
  }

  reportDbWriteSuccess() {
    this.metrics.dbWriteSuccess += 1;
  }

  reportDbWriteFailure() {
    this.metrics.dbWriteFailure += 1;
    this.lastWriteFailureAt = new Date().toISOString();
  }

  onAccountUpdate(listener: Listener<AccountUpdate>): () => void {
    this.accountListeners.add(listener);
    return () => {
      this.accountListeners.delete(listener);
    };
  }

  onTransactionUpdate(listener: Listener<TransactionUpdate>): () => void {
    this.transactionListeners.add(listener);
    return () => {
      this.transactionListeners.delete(listener);
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus() {
    const { SHYFT_GRPC_TOKEN, GRPC_ACCESS_MODE } = getEnv();
    const tokenConfigured = Boolean(SHYFT_GRPC_TOKEN);
    return {
      connected: this.connected,
      enabled: tokenConfigured && GRPC_ACCESS_MODE !== "off",
      lastError: this.lastError,
      endpointType: this.endpointType,
      subscriptionCount: this.subscriptions.size,
      accountCount: this.allSubscribedAccounts.size,
      reconnecting: this.reconnecting,
      lastEventAt: this.lastEventAt,
      lastWriteFailureAt: this.lastWriteFailureAt,
      metrics: { ...this.metrics },
    };
  }

  private scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.connected = false;

    log.warn("Scheduling reconnect in 5 seconds");

    setTimeout(async () => {
      this.reconnecting = false;
      const success = await this.connect();
      if (success && this.allSubscribedAccounts.size > 0) {
        log.info("Reconnected, re-subscribing", {
          accounts: this.allSubscribedAccounts.size,
        });
        await this.writeSubscription();
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
        // ignore
      }
      this.stream = null;
    }
    this.subscriptions.clear();
    this.allSubscribedAccounts.clear();
    this.accountListeners.clear();
    this.transactionListeners.clear();
  }
}

const globalForGrpc = globalThis as unknown as {
  grpcManager?: GrpcManager;
};

export const grpcManager =
  globalForGrpc.grpcManager ?? new GrpcManager();

if (process.env.NODE_ENV !== "production") {
  globalForGrpc.grpcManager = grpcManager;
}
