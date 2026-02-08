import { getEnv } from "@/lib/config/env";

const SHYFT_DEFI_API_BASE = "https://defi.shyft.to/v0";

type ShyftDefiResponse<T> = {
  success: boolean;
  message: string;
  result: T;
};

type PoolInfo = {
  address: string;
  dex: string;
  token_a: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    reserve: number;
  };
  token_b: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    reserve: number;
  };
  fee_rate: number;
  tvl_usd: number;
  volume_24h_usd: number;
  created_at: string;
};

type LiquidityDetails = {
  pool_address: string;
  dex: string;
  token_a_reserve: number;
  token_b_reserve: number;
  tvl_usd: number;
  price: number;
  fee_rate: number;
};

async function defiGet<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const { SHYFT_API_KEY } = getEnv();
  if (!SHYFT_API_KEY) {
    throw new Error("SHYFT_API_KEY is required for DeFi API");
  }

  const url = new URL(`${SHYFT_DEFI_API_BASE}${path}`);
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
    throw new Error(`Shyft DeFi API error (${response.status}): ${text}`);
  }

  const data = (await response.json()) as ShyftDefiResponse<T>;
  if (!data.success) {
    throw new Error(`Shyft DeFi API failed: ${data.message}`);
  }

  return data.result;
}

export const shyftDefiService = {
  async getPoolsByToken(tokenAddress: string): Promise<PoolInfo[]> {
    return await defiGet<PoolInfo[]>("/pools/get_by_token", {
      token: tokenAddress,
    });
  },

  async getPoolsByPair(
    tokenA: string,
    tokenB: string
  ): Promise<PoolInfo[]> {
    return await defiGet<PoolInfo[]>("/pools/get_by_pair", {
      token_a: tokenA,
      token_b: tokenB,
    });
  },

  async getLiquidityDetails(
    poolAddress: string
  ): Promise<LiquidityDetails> {
    return await defiGet<LiquidityDetails>(
      "/pools/get_liquidity_details",
      {
        pool: poolAddress,
      }
    );
  },

  async getPoolInfo(poolAddress: string): Promise<PoolInfo> {
    return await defiGet<PoolInfo>("/pools/get_by_address", {
      pool: poolAddress,
    });
  },
};

export type { PoolInfo, LiquidityDetails };
