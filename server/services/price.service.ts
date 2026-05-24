import "server-only";
import { PublicKey } from "@solana/web3.js";
import { getSolanaConnection } from "@/lib/solana/connection";
import { derivePumpAddresses } from "@/server/solana/pump/instructions";
import { shyftDefiService } from "@/server/services/shyft-defi.service";
import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";

const log = logger.child({ service: "price" });
const RPC_TIMEOUT_MS = 8_000;

const DISCRIMINATOR_SIZE = 8;
const PUMP_TOKEN_DECIMALS = 6;
const SOL_DECIMALS = 9;

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

const SOL_USD_CACHE_TTL_MS = 60_000;
let solUsdCache: { price: number; cachedAt: number } | null = null;

async function fetchSolUsdPrice(): Promise<number> {
  if (solUsdCache && Date.now() - solUsdCache.cachedAt < SOL_USD_CACHE_TTL_MS) {
    return solUsdCache.price;
  }

  const sources = [
    async () => {
      const res = await fetch(
        `https://api.jup.ag/price/v2?ids=${WRAPPED_SOL_MINT}`,
        { signal: AbortSignal.timeout(4_000) }
      );
      if (!res.ok) throw new Error(`Jupiter ${res.status}`);
      const data = (await res.json()) as {
        data?: Record<string, { price?: string }>;
      };
      return Number(data.data?.[WRAPPED_SOL_MINT]?.price ?? 0);
    },
    async () => {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        { signal: AbortSignal.timeout(4_000) }
      );
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      const data = (await res.json()) as { solana?: { usd?: number } };
      return data.solana?.usd ?? 0;
    },
  ];

  for (const source of sources) {
    try {
      const price = await source();
      if (price > 0) {
        solUsdCache = { price, cachedAt: Date.now() };
        return price;
      }
    } catch {
      continue;
    }
  }

  return solUsdCache?.price ?? 0;
}

export type PriceResult = {
  priceSol: number;
  virtualSolReserves: number;
  virtualTokenReserves: number;
  realSolReserves: number;
  realTokenReserves: number;
  tokenTotalSupply: number;
  isComplete: boolean;
};

type PriceCacheEntry = {
  result: PriceResult;
  cachedAt: number;
};

const CACHE_TTL_MS = 10_000;
const GRADUATED_CACHE_TTL_MS = 30_000;
const priceCache = new Map<string, PriceCacheEntry>();

function readU64(buffer: Buffer, offset: number): bigint {
  return buffer.readBigUInt64LE(offset);
}

function readBool(buffer: Buffer, offset: number): boolean {
  return buffer[offset] !== 0;
}

function decodeBondingCurveAccount(data: Buffer) {
  const offset = DISCRIMINATOR_SIZE;
  return {
    virtualTokenReserves: readU64(data, offset + 0),
    virtualSolReserves: readU64(data, offset + 8),
    realTokenReserves: readU64(data, offset + 16),
    realSolReserves: readU64(data, offset + 24),
    tokenTotalSupply: readU64(data, offset + 32),
    complete: readBool(data, offset + 40),
  };
}

function computePrice(
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): number {
  if (virtualTokenReserves === BigInt(0)) return 0;
  const solHuman = Number(virtualSolReserves) / 10 ** SOL_DECIMALS;
  const tokenHuman = Number(virtualTokenReserves) / 10 ** PUMP_TOKEN_DECIMALS;
  return solHuman / tokenHuman;
}

async function getGraduatedPrice(
  tokenPublicKey: string
): Promise<number | null> {
  const { SHYFT_API_KEY } = getEnv();
  if (!SHYFT_API_KEY) return null;

  try {
    const pools = await shyftDefiService.getPoolsByToken(tokenPublicKey);
    if (!pools || pools.length === 0) return null;

    const bestPool = pools.reduce((best, pool) =>
      pool.tvl_usd > best.tvl_usd ? pool : best
    );

    const isTokenA =
      bestPool.token_a.address.toLowerCase() ===
      tokenPublicKey.toLowerCase();
    const solToken = isTokenA ? bestPool.token_b : bestPool.token_a;
    const ourToken = isTokenA ? bestPool.token_a : bestPool.token_b;

    const isSolSide =
      solToken.address === WRAPPED_SOL_MINT ||
      solToken.symbol === "SOL" ||
      solToken.symbol === "WSOL";

    if (isSolSide && ourToken.reserve > 0) {
      return solToken.reserve / ourToken.reserve;
    }

    return null;
  } catch (error) {
    log.warn("Failed to fetch graduated price", {
      tokenPublicKey,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

export const priceService = {
  getSolUsdPrice: fetchSolUsdPrice,

  async getCurrentPrice(
    tokenPublicKey: string
  ): Promise<PriceResult | null> {
    const cached = priceCache.get(tokenPublicKey);
    const ttl = cached?.result.isComplete
      ? GRADUATED_CACHE_TTL_MS
      : CACHE_TTL_MS;
    if (cached && Date.now() - cached.cachedAt < ttl) {
      return cached.result;
    }

    try {
      const mint = new PublicKey(tokenPublicKey);
      const { bondingCurve } = derivePumpAddresses(mint);
      const connection = getSolanaConnection();

      const accountInfo = await Promise.race([
        connection.getAccountInfo(bondingCurve, "confirmed"),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("RPC timeout")), RPC_TIMEOUT_MS)
        ),
      ]);

      if (!accountInfo || !accountInfo.data) {
        return cached?.result ?? null;
      }

      const decoded = decodeBondingCurveAccount(accountInfo.data as Buffer);
      let priceSol = computePrice(
        decoded.virtualSolReserves,
        decoded.virtualTokenReserves
      );

      const isComplete = decoded.complete;

      if (isComplete) {
        const graduatedPrice = await getGraduatedPrice(tokenPublicKey);
        if (graduatedPrice !== null && graduatedPrice > 0) {
          priceSol = graduatedPrice;
        }
      }

      const result: PriceResult = {
        priceSol,
        virtualSolReserves:
          Number(decoded.virtualSolReserves) / 10 ** SOL_DECIMALS,
        virtualTokenReserves:
          Number(decoded.virtualTokenReserves) / 10 ** PUMP_TOKEN_DECIMALS,
        realSolReserves:
          Number(decoded.realSolReserves) / 10 ** SOL_DECIMALS,
        realTokenReserves:
          Number(decoded.realTokenReserves) / 10 ** PUMP_TOKEN_DECIMALS,
        tokenTotalSupply:
          Number(decoded.tokenTotalSupply) / 10 ** PUMP_TOKEN_DECIMALS,
        isComplete,
      };

      priceCache.set(tokenPublicKey, { result, cachedAt: Date.now() });

      if (priceCache.size > 200) {
        const oldestKey = priceCache.keys().next().value;
        if (oldestKey) priceCache.delete(oldestKey);
      }

      return result;
    } catch (error) {
      log.error("Failed to fetch current price", {
        tokenPublicKey,
        error: error instanceof Error ? error.message : error,
      });
      return cached?.result ?? null;
    }
  },
};
