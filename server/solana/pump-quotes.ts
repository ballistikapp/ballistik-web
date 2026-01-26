import { AnchorProvider, BN } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import type { Keypair, PublicKey } from "@solana/web3.js";
import { getSolanaConnection } from "@/lib/solana/connection";
import { getPumpProgram } from "@/server/solana/pump-idl";
import { derivePumpAddresses } from "@/server/solana/pump-new-idl";

type PumpQuoteState = {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  protocolFeeBps: bigint;
  creatorFeeBps: bigint;
};

const ZERO = BigInt(0);
const ONE = BigInt(1);
const MAX_BPS = BigInt(10_000);

const toBigInt = (value: unknown) => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.floor(value));
  if (typeof value === "string") return BigInt(value);
  if (value instanceof BN) {
    return BigInt((value as BN).toString());
  }
  if (
    value &&
    typeof (value as { toString?: () => string }).toString === "function"
  ) {
    return BigInt((value as { toString: () => string }).toString());
  }
  throw new Error("Unsupported numeric value");
};

const pickField = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
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

export const fetchPumpQuoteState = async (
  mint: PublicKey,
  payer: Keypair
): Promise<PumpQuoteState> => {
  const connection = getSolanaConnection();
  const provider = new AnchorProvider(connection, new NodeWallet(payer), {
    commitment: "confirmed",
  });
  const program = getPumpProgram(provider);
  const { bondingCurve, global } = derivePumpAddresses(mint);
  const [bondingInfo, globalInfo] = await connection.getMultipleAccountsInfo(
    [bondingCurve, global],
    "confirmed"
  );

  if (!bondingInfo) {
    throw new Error("Bonding curve account not found");
  }
  if (!globalInfo) {
    throw new Error("Global account not found");
  }

  const bondingCurveData = program.coder.accounts.decode(
    "BondingCurve",
    bondingInfo.data
  ) as Record<string, unknown>;
  const globalData = program.coder.accounts.decode(
    "Global",
    globalInfo.data
  ) as Record<string, unknown>;

  const virtualTokenReserves = toBigInt(
    pickField(bondingCurveData, [
      "virtualTokenReserves",
      "virtual_token_reserves",
    ])
  );
  const virtualSolReserves = toBigInt(
    pickField(bondingCurveData, ["virtualSolReserves", "virtual_sol_reserves"])
  );
  const protocolFeeBps = toBigInt(
    pickField(globalData, ["feeBasisPoints", "fee_basis_points"]) ?? 0
  );
  const creatorFeeBps = toBigInt(
    pickField(globalData, [
      "creatorFeeBasisPoints",
      "creator_fee_basis_points",
    ]) ?? 0
  );

  return {
    virtualTokenReserves,
    virtualSolReserves,
    protocolFeeBps,
    creatorFeeBps,
  };
};

export const computeBuyQuote = (
  state: PumpQuoteState,
  spendableLamports: bigint
) => {
  const totalFeeBps = state.protocolFeeBps + state.creatorFeeBps;
  let netSol = (spendableLamports * MAX_BPS) / (MAX_BPS + totalFeeBps);
  const protocolFees = ceilDiv(netSol * state.protocolFeeBps, MAX_BPS);
  const creatorFees = ceilDiv(netSol * state.creatorFeeBps, MAX_BPS);

  if (netSol + protocolFees + creatorFees > spendableLamports) {
    netSol = netSol - (netSol + protocolFees + creatorFees - spendableLamports);
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
  const totalFeeBps = state.protocolFeeBps + state.creatorFeeBps;
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
