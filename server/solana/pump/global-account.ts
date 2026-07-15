import "server-only";
import { type BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import { getSolanaConnection } from "@/lib/solana/connection";
import { AppError } from "@/server/errors";
import {
  getPumpAccountsCoder,
  PUMP_PROGRAM_ID,
} from "@/server/solana/pump/idl";

const GLOBAL_SEED = Buffer.from("global");

export type GlobalSnapshot = {
  feeBasisPoints: bigint;
  creatorFeeBasisPoints: bigint;
  buybackBasisPoints: bigint;
  buybackFeeRecipients: PublicKey[];
  createV2Enabled: boolean;
  mayhemModeEnabled: boolean;
  reservedFeeRecipient: PublicKey;
  reservedFeeRecipients: PublicKey[];
};

interface GlobalAccountData {
  fee_basis_points: BN;
  creator_fee_basis_points: BN;
  buyback_basis_points: BN;
  buyback_fee_recipients: PublicKey[];
  create_v2_enabled: boolean;
  mayhem_mode_enabled: boolean;
  reserved_fee_recipient: PublicKey;
  reserved_fee_recipients: PublicKey[];
}

export type BondingCurveSnapshot = {
  creator: PublicKey;
  isMayhemMode: boolean;
  complete: boolean;
};

interface BondingCurveAccountData {
  creator: PublicKey;
  is_mayhem_mode: boolean;
  complete: boolean;
}

/** Decodes a `BondingCurve` account. Used to decide token-program / fee-recipient routing for buy/sell. */
export function decodeBondingCurve(data: Buffer): BondingCurveSnapshot {
  const decoded = getPumpAccountsCoder().decode<BondingCurveAccountData>(
    "BondingCurve",
    data
  );
  return {
    creator: new PublicKey(decoded.creator),
    isMayhemMode: decoded.is_mayhem_mode,
    complete: decoded.complete,
  };
}

const GLOBAL_TTL_MS = 5 * 60 * 1000;
let globalCache: { value: GlobalSnapshot; cachedAt: number } | null = null;
let globalInflight: Promise<GlobalSnapshot> | null = null;

async function fetchGlobalSnapshot(): Promise<GlobalSnapshot> {
  const connection = getSolanaConnection();
  const [globalPda] = PublicKey.findProgramAddressSync(
    [GLOBAL_SEED],
    PUMP_PROGRAM_ID
  );
  const info = await connection.getAccountInfo(globalPda, "confirmed");
  if (!info?.data) {
    throw new Error("Pump.fun Global account not found");
  }

  const decoded = getPumpAccountsCoder().decode<GlobalAccountData>(
    "Global",
    info.data as Buffer
  );

  return {
    feeBasisPoints: BigInt(decoded.fee_basis_points.toString()),
    creatorFeeBasisPoints: BigInt(decoded.creator_fee_basis_points.toString()),
    buybackBasisPoints: BigInt(decoded.buyback_basis_points.toString()),
    buybackFeeRecipients: decoded.buyback_fee_recipients.map(
      (p) => new PublicKey(p)
    ),
    createV2Enabled: decoded.create_v2_enabled,
    mayhemModeEnabled: decoded.mayhem_mode_enabled,
    reservedFeeRecipient: new PublicKey(decoded.reserved_fee_recipient),
    reservedFeeRecipients: decoded.reserved_fee_recipients.map(
      (p) => new PublicKey(p)
    ),
  };
}

export async function getGlobalSnapshot(): Promise<GlobalSnapshot> {
  if (globalCache && Date.now() - globalCache.cachedAt < GLOBAL_TTL_MS) {
    return globalCache.value;
  }
  if (globalInflight) return globalInflight;

  globalInflight = (async () => {
    try {
      const snapshot = await fetchGlobalSnapshot();
      globalCache = { value: snapshot, cachedAt: Date.now() };
      logger.info("Pump Global snapshot refreshed", {
        feeBps: snapshot.feeBasisPoints.toString(),
        creatorFeeBps: snapshot.creatorFeeBasisPoints.toString(),
        buybackBps: snapshot.buybackBasisPoints.toString(),
        buybackRecipients: snapshot.buybackFeeRecipients.map((p) =>
          p.toBase58()
        ),
      });
      return snapshot;
    } finally {
      globalInflight = null;
    }
  })();

  return globalInflight;
}

let envBuybackRecipientsCache: PublicKey[] | null = null;

function parseEnvBuybackRecipients(): PublicKey[] | null {
  const { PUMP_BUYBACK_FEE_RECIPIENTS } = getEnv();
  if (!PUMP_BUYBACK_FEE_RECIPIENTS) return null;
  if (envBuybackRecipientsCache) return envBuybackRecipientsCache;

  const parts = PUMP_BUYBACK_FEE_RECIPIENTS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length !== 8) {
    throw new Error(
      `PUMP_BUYBACK_FEE_RECIPIENTS must contain exactly 8 base58 pubkeys (got ${parts.length})`
    );
  }
  envBuybackRecipientsCache = parts.map((p) => new PublicKey(p));
  logger.info("Using PUMP_BUYBACK_FEE_RECIPIENTS from env", {
    recipients: envBuybackRecipientsCache.map((p) => p.toBase58()),
  });
  return envBuybackRecipientsCache;
}

export async function getBuybackFeeRecipients(): Promise<PublicKey[]> {
  const fromEnv = parseEnvBuybackRecipients();
  if (fromEnv) return fromEnv;
  const snapshot = await getGlobalSnapshot();
  return snapshot.buybackFeeRecipients;
}

/** Mayhem-mode trades route protocol fees to the reserved pool instead of the standard buyback pool. */
export async function getReservedFeeRecipients(): Promise<PublicKey[]> {
  const snapshot = await getGlobalSnapshot();
  return snapshot.reservedFeeRecipients;
}

export async function assertMayhemCreateAllowed(
  isMayhemMode: boolean
): Promise<void> {
  const snapshot = await getGlobalSnapshot();
  if (!snapshot.createV2Enabled) {
    throw new AppError(
      "Token creation is temporarily unavailable: create v2 is disabled on pump.fun.",
      503
    );
  }
  if (isMayhemMode && !snapshot.mayhemModeEnabled) {
    throw new AppError(
      "Mayhem mode is currently disabled on pump.fun for new coins. Please try again later or launch without Mayhem mode.",
      400
    );
  }
}

export function invalidateGlobalCache(): void {
  globalCache = null;
}
