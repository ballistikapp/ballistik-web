import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import {
  grpcManager,
  type TransactionUpdate,
} from "./grpc-manager";

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

class TokenTransactionsGrpcManager {
  private tokenSubscriptions = new Map<string, TokenSubscription>();
  private accountToTokens = new Map<string, Set<string>>();
  private removeTransactionListener: (() => void) | null = null;

  constructor() {
    this.removeTransactionListener = grpcManager.onTransactionUpdate(
      (update: TransactionUpdate) => this.handleUpdate(update)
    );
  }

  private handleUpdate(update: TransactionUpdate) {
    const tokenMatches = new Set<string>();
    update.accountKeys.forEach((key) => {
      const tokens = this.accountToTokens.get(key);
      if (tokens) {
        tokens.forEach((token) => tokenMatches.add(token));
      }
    });
    if (tokenMatches.size === 0) return;
    tokenMatches.forEach((tokenPublicKey) => {
      this.addSignature(tokenPublicKey, update.signature);
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

    let hasNewAccounts = false;
    accounts.forEach((account) => {
      if (!state.accounts.includes(account)) {
        state.accounts.push(account);
        hasNewAccounts = true;
      }
      const tokens = this.accountToTokens.get(account) ?? new Set<string>();
      tokens.add(tokenPublicKey);
      this.accountToTokens.set(account, tokens);
    });

    if (state.subscribed && !hasNewAccounts) {
      return true;
    }

    const subscriptionId = `tokenTx:${tokenPublicKey}`;
    const success = await grpcManager.subscribe(
      subscriptionId,
      state.accounts
    );
    if (success) {
      state.subscribed = true;
    }
    return success;
  }

  getState(tokenPublicKey: string) {
    return this.tokenSubscriptions.get(tokenPublicKey) ?? null;
  }

  getStatus() {
    return grpcManager.getStatus();
  }

  shutdown() {
    this.removeTransactionListener?.();
    this.tokenSubscriptions.clear();
    this.accountToTokens.clear();
  }
}

const globalForTokenGrpc = globalThis as unknown as {
  tokenTransactionsGrpc?: TokenTransactionsGrpcManager;
};

export const tokenTransactionsGrpc =
  globalForTokenGrpc.tokenTransactionsGrpc ??
  new TokenTransactionsGrpcManager();

if (process.env.NODE_ENV !== "production") {
  globalForTokenGrpc.tokenTransactionsGrpc = tokenTransactionsGrpc;
}
