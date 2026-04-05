import "server-only";
import { getEnv } from "@/lib/config/env";

const SHYFT_API_BASE = "https://api.shyft.to/sol/v1";

type ShyftApiResponse<T> = {
  success: boolean;
  message: string;
  result: T;
};

type WalletBalanceResult = {
  balance: number;
};

type TokenBalanceEntry = {
  address: string;
  balance: number;
  associated_account: string;
  info: {
    name: string;
    symbol: string;
    image: string;
    decimals: number;
  };
};

type AllTokensResult = TokenBalanceEntry[];

type TransactionHistoryEntry = {
  timestamp: string;
  fee: number;
  fee_payer: string;
  signers: string[];
  signatures: string[];
  protocol: Record<string, unknown>;
  type: string;
  status: string;
  actions: Array<{
    type: string;
    info: Record<string, unknown>;
    source_protocol?: Record<string, unknown>;
  }>;
  events?: Record<string, unknown>;
};

type ParsedTransactionEntry = {
  timestamp: string;
  fee: number;
  fee_payer: string;
  signers: string[];
  signatures: string[];
  protocol: Record<string, unknown>;
  type: string;
  status: string;
  actions: Array<{
    type: string;
    info: Record<string, unknown>;
    source_protocol?: Record<string, unknown>;
  }>;
};

async function shyftGet<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const { SHYFT_API_KEY } = getEnv();
  if (!SHYFT_API_KEY) {
    throw new Error("SHYFT_API_KEY is required");
  }

  const url = new URL(`${SHYFT_API_BASE}${path}`);
  url.searchParams.set("network", "mainnet-beta");
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      "x-api-key": SHYFT_API_KEY,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shyft API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as ShyftApiResponse<T>;
  if (!data.success) {
    throw new Error(`Shyft API failed: ${data.message}`);
  }

  return data.result;
}

async function shyftPost<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const { SHYFT_API_KEY } = getEnv();
  if (!SHYFT_API_KEY) {
    throw new Error("SHYFT_API_KEY is required");
  }

  const response = await fetch(`${SHYFT_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": SHYFT_API_KEY,
    },
    body: JSON.stringify({
      network: "mainnet-beta",
      ...body,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shyft API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as ShyftApiResponse<T>;
  if (!data.success) {
    throw new Error(`Shyft API failed: ${data.message}`);
  }

  return data.result;
}

export const shyftApiService = {
  async getWalletBalance(walletAddress: string): Promise<number> {
    const result = await shyftGet<WalletBalanceResult>("/wallet/balance", {
      wallet: walletAddress,
    });
    return result.balance;
  },

  async getAllTokens(walletAddress: string): Promise<TokenBalanceEntry[]> {
    const result = await shyftGet<AllTokensResult>("/wallet/all_tokens", {
      wallet: walletAddress,
    });
    return result;
  },

  async getTokenBalance(
    walletAddress: string,
    tokenAddress: string
  ): Promise<{ balance: number; decimals: number; associatedAccount: string }> {
    const result = await shyftGet<{ balance: number; decimals: number; associated_account: string }>(
      "/wallet/token_balance",
      {
        wallet: walletAddress,
        token: tokenAddress,
      }
    );
    return { balance: result.balance, decimals: result.decimals, associatedAccount: result.associated_account };
  },

  async getTransactionHistory(
    accountAddress: string,
    options?: {
      txNum?: number;
      beforeTxSignature?: string;
      enableRaw?: boolean;
      enableEvents?: boolean;
    }
  ): Promise<TransactionHistoryEntry[]> {
    const params: Record<string, string> = {
      account: accountAddress,
    };
    if (options?.txNum) params.tx_num = String(options.txNum);
    if (options?.beforeTxSignature) params.before_tx_signature = options.beforeTxSignature;
    if (options?.enableRaw) params.enable_raw = "true";
    if (options?.enableEvents) params.enable_events = "true";

    return await shyftGet<TransactionHistoryEntry[]>(
      "/transaction/history",
      params
    );
  },

  async parseTransactions(
    signatures: string[]
  ): Promise<ParsedTransactionEntry[]> {
    return await shyftPost<ParsedTransactionEntry[]>(
      "/transaction/parse_selected",
      {
        transaction_signatures: signatures,
      }
    );
  },

  async sendTransaction(
    encodedTransaction: string,
    options?: { skipPreflight?: boolean }
  ): Promise<string> {
    const result = await shyftPost<string>("/transaction/send_txn", {
      encoded_transaction: encodedTransaction,
      ...(options?.skipPreflight !== undefined
        ? { skip_preflight: options.skipPreflight }
        : {}),
    });
    return result;
  },
};

export type { TokenBalanceEntry, TransactionHistoryEntry, ParsedTransactionEntry };
