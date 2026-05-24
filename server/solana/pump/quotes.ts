import { BN } from "@coral-xyz/anchor";
import type { Keypair, PublicKey } from "@solana/web3.js";
import { getSolanaConnection } from "@/lib/solana/connection";
import { getGlobalSnapshot } from "@/server/solana/pump/global-account";
import { derivePumpAddresses } from "@/server/solana/pump/instructions";
import { cacheConfig } from "@/lib/config/cache.config";

type PumpQuoteState = {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
  buybackFeeBps: bigint;
};

const ZERO = BigInt(0);
const ONE = BigInt(1);
const MAX_BPS = BigInt(10_000);

type CacheEntry = {
  state: PumpQuoteState;
  cachedAt: number;
};

const bondingCurveCache = new Map<string, CacheEntry>();

function getCachedState(mintKey: string): PumpQuoteState | null {
  const entry = bondingCurveCache.get(mintKey);
  if (!entry) return null;
  const ttl = cacheConfig.ttlMs?.bondingCurve ?? 5_000;
  if (Date.now() - entry.cachedAt > ttl) {
    bondingCurveCache.delete(mintKey);
    return null;
  }
  return entry.state;
}

function setCachedState(mintKey: string, state: PumpQuoteState) {
  bondingCurveCache.set(mintKey, { state, cachedAt: Date.now() });
  if (bondingCurveCache.size > 500) {
    const oldestKey = bondingCurveCache.keys().next().value;
    if (oldestKey) bondingCurveCache.delete(oldestKey);
  }
}

const DISCRIMINATOR_SIZE = 8;

const readU64 = (buffer: Buffer, offset: number): bigint => {
  return buffer.readBigUInt64LE(offset);
};

const clampBps = (bps: number) => {
  if (!Number.isFinite(bps)) return ZERO;
  return BigInt(Math.min(Math.max(Math.round(bps), 0), Number(MAX_BPS)));
};

const ceilDiv = (a: bigint, b: bigint) => {
  if (b === ZERO) return ZERO;
  return (a + b - ONE) / b;
};

const applySlippage = (amount: bigint, slippageBps: number) => {
  const bps = clampBps(slippageBps);
  return (amount * (MAX_BPS - bps)) / MAX_BPS;
};

const decodeBondingCurve = (data: Buffer) => {
  const offset = DISCRIMINATOR_SIZE;
  return {
    virtualTokenReserves: readU64(data, offset + 0),
    virtualSolReserves: readU64(data, offset + 8),
    realTokenReserves: readU64(data, offset + 16),
    realSolReserves: readU64(data, offset + 24),
    tokenTotalSupply: readU64(data, offset + 32),
  };
};

export const fetchPumpQuoteState = async (
  mint: PublicKey,
  _payer: Keypair
): Promise<PumpQuoteState> => {
  const mintKey = mint.toBase58();
  const cached = getCachedState(mintKey);
  if (cached) {
    return cached;
  }

  const connection = getSolanaConnection();
  const { bondingCurve } = derivePumpAddresses(mint);
  const [bondingInfo, globalSnapshot] = await Promise.all([
    connection.getAccountInfo(bondingCurve, "confirmed"),
    getGlobalSnapshot(),
  ]);

  if (!bondingInfo) {
    throw new Error("Bonding curve account not found");
  }

  const bondingCurveData = decodeBondingCurve(bondingInfo.data as Buffer);

  const state: PumpQuoteState = {
    virtualTokenReserves: bondingCurveData.virtualTokenReserves,
    virtualSolReserves: bondingCurveData.virtualSolReserves,
    protocolFeeBps: globalSnapshot.feeBasisPoints,
    creatorFeeBps: globalSnapshot.creatorFeeBasisPoints,
    buybackFeeBps: globalSnapshot.buybackBasisPoints,
  };

  setCachedState(mintKey, state);

  return state;
};

export const computeBuyQuote = (
  state: PumpQuoteState,
  spendableLamports: bigint
) => {
  const totalFeeBps =
    state.protocolFeeBps + state.creatorFeeBps + state.buybackFeeBps;
  let netSol = (spendableLamports * MAX_BPS) / (MAX_BPS + totalFeeBps);
  const protocolFees = ceilDiv(netSol * state.protocolFeeBps, MAX_BPS);
  const creatorFees = ceilDiv(netSol * state.creatorFeeBps, MAX_BPS);
  const buybackFees = ceilDiv(netSol * state.buybackFeeBps, MAX_BPS);

  if (netSol + protocolFees + creatorFees + buybackFees > spendableLamports) {
    netSol =
      netSol -
      (netSol + protocolFees + creatorFees + buybackFees - spendableLamports);
  }

  const effectiveSol = netSol > ZERO ? netSol - ONE : ZERO;
  const tokensOut =
    effectiveSol === ZERO
      ? ZERO
      : (effectiveSol * state.virtualTokenReserves) /
        (state.virtualSolReserves + effectiveSol);

  return {
    netSolIn: netSol,
    tokensOut,
    protocolFees,
    creatorFees,
    buybackFees,
  };
};

export const computeSellQuote = (
  state: PumpQuoteState,
  tokenAmount: bigint
) => {
  if (tokenAmount <= ZERO) {
    return { solOut: ZERO, netSolOut: ZERO, feeAmount: ZERO };
  }
  const solOut =
    (tokenAmount * state.virtualSolReserves) /
    (state.virtualTokenReserves + tokenAmount);
  const totalFeeBps =
    state.protocolFeeBps + state.creatorFeeBps + state.buybackFeeBps;
  const feeAmount = ceilDiv(solOut * totalFeeBps, MAX_BPS);
  const netSolOut = solOut > feeAmount ? solOut - feeAmount : ZERO;

  return { solOut, netSolOut, feeAmount };
};

export const computeMinTokensOutForBuy = (
  state: PumpQuoteState,
  spendableLamports: bigint,
  slippageBps: number
) => {
  const { tokensOut } = computeBuyQuote(state, spendableLamports);

  const minOut = applySlippage(tokensOut, slippageBps);
  const boundedMin = tokensOut === ZERO ? ZERO : minOut === ZERO ? ONE : minOut;

  return new BN(boundedMin.toString());
};

export const computeMinSolOutForSell = (
  state: PumpQuoteState,
  tokenAmount: bigint,
  slippageBps: number
) => {
  const { netSolOut } = computeSellQuote(state, tokenAmount);
  const minOut = applySlippage(netSolOut, slippageBps);
  const boundedMin = minOut > ZERO ? minOut - ONE : ZERO;

  return new BN(boundedMin.toString());
};

export const estimateTokenAmountForNetSolOut = (
  state: PumpQuoteState,
  targetNetSolOut: bigint,
  maxTokenAmount: bigint
) => {
  if (targetNetSolOut <= ZERO || maxTokenAmount <= ZERO) {
    return ZERO;
  }
  let low = ZERO;
  let high = maxTokenAmount;
  for (let i = 0; i < 64; i += 1) {
    const mid = (low + high) / BigInt(2);
    const { netSolOut } = computeSellQuote(state, mid);
    if (netSolOut < targetNetSolOut) {
      low = mid + ONE;
    } else {
      high = mid;
    }
  }
  return high;
};
