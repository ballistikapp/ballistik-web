import { PublicKey } from "@solana/web3.js";
import { getSolanaConnection } from "@/lib/solana/connection";
import { derivePumpAddresses } from "@/server/solana/pump-new-idl";

const DISCRIMINATOR_SIZE = 8;
const PUMP_TOKEN_DECIMALS = 6;
const SOL_DECIMALS = 9;

type PriceResult = {
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

export const priceService = {
  async getCurrentPrice(
    tokenPublicKey: string
  ): Promise<PriceResult | null> {
    const cached = priceCache.get(tokenPublicKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.result;
    }

    try {
      const mint = new PublicKey(tokenPublicKey);
      const { bondingCurve } = derivePumpAddresses(mint);
      const connection = getSolanaConnection();

      const accountInfo = await connection.getAccountInfo(
        bondingCurve,
        "confirmed"
      );

      if (!accountInfo || !accountInfo.data) {
        return null;
      }

      const decoded = decodeBondingCurveAccount(accountInfo.data as Buffer);
      const priceSol = computePrice(
        decoded.virtualSolReserves,
        decoded.virtualTokenReserves
      );

      const result: PriceResult = {
        priceSol,
        virtualSolReserves: Number(decoded.virtualSolReserves) / 10 ** SOL_DECIMALS,
        virtualTokenReserves:
          Number(decoded.virtualTokenReserves) / 10 ** PUMP_TOKEN_DECIMALS,
        realSolReserves: Number(decoded.realSolReserves) / 10 ** SOL_DECIMALS,
        realTokenReserves:
          Number(decoded.realTokenReserves) / 10 ** PUMP_TOKEN_DECIMALS,
        tokenTotalSupply:
          Number(decoded.tokenTotalSupply) / 10 ** PUMP_TOKEN_DECIMALS,
        isComplete: decoded.complete,
      };

      priceCache.set(tokenPublicKey, { result, cachedAt: Date.now() });

      if (priceCache.size > 200) {
        const oldestKey = priceCache.keys().next().value;
        if (oldestKey) priceCache.delete(oldestKey);
      }

      return result;
    } catch {
      return null;
    }
  },
};
