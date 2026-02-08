import {
  grpcManager,
  type AccountUpdate,
  type TransactionUpdate,
} from "./grpc-manager";

type BalanceUpdate = { lamports: number; slot: number };
type TokenUpdate = { amount: bigint; slot: number };

type SessionSubscription = {
  wallets: string[];
  mint: string;
  bondingCurve: string;
};

type PendingConfirmation = {
  resolve: (confirmed: boolean) => void;
  timeout: NodeJS.Timeout;
};

class VolumeBotGrpcManager {
  private solBalances = new Map<string, BalanceUpdate>();
  private tokenBalances = new Map<string, TokenUpdate>();
  private bondingCurves = new Map<string, unknown>();

  private confirmedTxs = new Set<string>();
  private pendingTxs = new Map<string, PendingConfirmation>();

  private sessionSubscriptions = new Map<string, SessionSubscription>();
  private removeAccountListener: (() => void) | null = null;
  private removeTransactionListener: (() => void) | null = null;

  constructor() {
    this.removeAccountListener = grpcManager.onAccountUpdate(
      (update: AccountUpdate) => this.handleAccountUpdate(update)
    );
    this.removeTransactionListener = grpcManager.onTransactionUpdate(
      (update: TransactionUpdate) => this.handleTransactionUpdate(update)
    );
  }

  private handleAccountUpdate(update: AccountUpdate) {
    const existingBalance = this.solBalances.get(update.pubkey);
    if (!existingBalance || existingBalance.slot < update.slot) {
      this.solBalances.set(update.pubkey, {
        lamports: update.lamports,
        slot: update.slot,
      });
    }

    if (update.owner && update.mint && update.tokenAmount !== undefined) {
      const key = `${update.owner}:${update.mint}`;
      const existingToken = this.tokenBalances.get(key);
      if (!existingToken || existingToken.slot < update.slot) {
        this.tokenBalances.set(key, {
          amount: update.tokenAmount,
          slot: update.slot,
        });
      }
    }
  }

  private handleTransactionUpdate(update: TransactionUpdate) {
    this.confirmedTxs.add(update.signature);

    const pending = this.pendingTxs.get(update.signature);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve(true);
      this.pendingTxs.delete(update.signature);
    }
  }

  async connect(): Promise<boolean> {
    return grpcManager.connect();
  }

  async subscribeToSession(
    sessionId: string,
    walletPubkeys: string[],
    mintPubkey: string,
    bondingCurvePubkey: string
  ): Promise<boolean> {
    this.sessionSubscriptions.set(sessionId, {
      wallets: walletPubkeys,
      mint: mintPubkey,
      bondingCurve: bondingCurvePubkey,
    });

    const accounts = [bondingCurvePubkey, ...walletPubkeys];
    const subscriptionId = `volumeBot:${sessionId}`;

    const success = await grpcManager.subscribe(subscriptionId, accounts);
    if (success) {
      console.log(
        `[VolumeBotGrpc] Subscribed to session ${sessionId} with ${walletPubkeys.length} wallets`
      );
    }
    return success;
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
    return grpcManager.isConnected();
  }

  async waitForConfirmation(
    signature: string,
    timeoutMs = 30000
  ): Promise<boolean> {
    if (this.confirmedTxs.has(signature)) return true;
    if (!grpcManager.isConnected()) return false;

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
    grpcManager.unsubscribe(`volumeBot:${sessionId}`);
  }

  shutdown() {
    this.removeAccountListener?.();
    this.removeTransactionListener?.();
    this.solBalances.clear();
    this.tokenBalances.clear();
    this.bondingCurves.clear();
    this.confirmedTxs.clear();
    this.pendingTxs.forEach((p) => clearTimeout(p.timeout));
    this.pendingTxs.clear();
    this.sessionSubscriptions.clear();
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
