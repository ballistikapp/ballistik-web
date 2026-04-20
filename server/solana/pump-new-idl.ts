import { randomInt } from "node:crypto";
import type { Program } from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { CreateTokenMetadata } from "pumpdotfun-sdk";

import { MAYHEM_PROGRAM_ID_STR } from "@/lib/config/pump-mayhem.config";
import { getSolanaConnection } from "@/lib/solana/connection";
import { logger } from "@/lib/logger";
import { AppError } from "@/server/errors";
import { PUMP_PROGRAM_ID } from "@/server/solana/pump-idl";

const GLOBAL_SEED = Buffer.from("global");
const BONDING_CURVE_SEED = Buffer.from("bonding-curve");
const MINT_AUTHORITY_SEED = Buffer.from("mint-authority");
const GLOBAL_PARAMS_SEED = Buffer.from("global-params");
const SOL_VAULT_SEED = Buffer.from("sol-vault");
const MAYHEM_STATE_SEED = Buffer.from("mayhem-state");

/** Mayhem program: PDAs for `createV2` (global params, sol vault, mayhem state). */
export const MAYHEM_PROGRAM_ID = new PublicKey(MAYHEM_PROGRAM_ID_STR);

const FEE_PROGRAM_ID = new PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
);

/** Borsh layout offsets in pump `Global` account data (`data/pump.json`), after 8-byte disc. */
const GLOBAL_OFFSET_CREATE_V2_ENABLED = 450;
const GLOBAL_OFFSET_MAYHEM_MODE_ENABLED = 515;

export const DISCRIMINATORS = {
  CREATE: Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]),
  BUY: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
  BUY_EXACT_SOL_IN: Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]),
  SELL: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
} as const;

export interface BondingCurveState {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realTokenReserves: bigint;
}

export function calculateBuyTokenAmount(
  solAmountLamports: bigint,
  state: BondingCurveState
): bigint {
  if (solAmountLamports <= BigInt(0)) return BigInt(0);
  const product = state.virtualSolReserves * state.virtualTokenReserves;
  const newSolReserves = state.virtualSolReserves + solAmountLamports;
  const newTokenReserves = product / newSolReserves + BigInt(1);
  const tokensOut = state.virtualTokenReserves - newTokenReserves;
  return tokensOut < state.realTokenReserves
    ? tokensOut
    : state.realTokenReserves;
}

export function applyBuyToState(
  tokenAmount: bigint,
  solAmount: bigint,
  state: BondingCurveState
): BondingCurveState {
  return {
    virtualSolReserves: state.virtualSolReserves + solAmount,
    virtualTokenReserves: state.virtualTokenReserves - tokenAmount,
    realTokenReserves: state.realTokenReserves - tokenAmount,
  };
}

/** After8-byte disc: bool + authority pubkey; `feeRecipient` is next32 bytes (`data/pump.json` Global). */
const GLOBAL_OFFSET_FEE_RECIPIENT = 8 + 1 + 32;
/** Standard protocol fee recipient pool: `feeRecipients` array (`data/pump.json` Global). */
const GLOBAL_OFFSET_FEE_RECIPIENTS_START = 162;
const GLOBAL_FEE_RECIPIENT_POOL_LEN = 7;
/** Mayhem fee recipients (`reservedFeeRecipient` + `reservedFeeRecipients`). */
const GLOBAL_OFFSET_RESERVED_FEE_RECIPIENT = 483;
const GLOBAL_OFFSET_RESERVED_FEE_RECIPIENTS_START = 516;

/** BondingCurve: 8 disc + 5×u64 + `complete` + `creator` + `isMayhemMode` (`data/pump.json`). */
const BONDING_CURVE_OFFSET_IS_MAYHEM = 8 + 40 + 1 + 32;

function pubkeySliceNonZero(buf: Buffer, offset: number): boolean {
  const end = offset + 32;
  if (buf.length < end) return false;
  return buf.subarray(offset, end).some((b) => b !== 0);
}

export function readPumpGlobalFeeRecipient(globalData: Buffer): PublicKey {
  const end = GLOBAL_OFFSET_FEE_RECIPIENT + 32;
  if (globalData.length < end) {
    throw new Error("Pump Global account data too short for feeRecipient");
  }
  return new PublicKey(globalData.subarray(GLOBAL_OFFSET_FEE_RECIPIENT, end));
}

/** Whether the bonding curve account marks this mint as pump mayhem mode (affects fee recipient). */
export function readBondingCurveIsMayhemMode(bondingCurveData: Buffer): boolean {
  const end = BONDING_CURVE_OFFSET_IS_MAYHEM + 1;
  if (bondingCurveData.length < end) {
    return false;
  }
  return bondingCurveData.readUInt8(BONDING_CURVE_OFFSET_IS_MAYHEM) !== 0;
}

function collectPumpStandardFeeRecipients(globalData: Buffer): PublicKey[] {
  const out: PublicKey[] = [];
  if (pubkeySliceNonZero(globalData, GLOBAL_OFFSET_FEE_RECIPIENT)) {
    out.push(
      new PublicKey(
        globalData.subarray(
          GLOBAL_OFFSET_FEE_RECIPIENT,
          GLOBAL_OFFSET_FEE_RECIPIENT + 32
        )
      )
    );
  }
  for (let i = 0; i < GLOBAL_FEE_RECIPIENT_POOL_LEN; i++) {
    const start = GLOBAL_OFFSET_FEE_RECIPIENTS_START + i * 32;
    if (pubkeySliceNonZero(globalData, start)) {
      out.push(new PublicKey(globalData.subarray(start, start + 32)));
    }
  }
  return out;
}

function collectPumpReservedFeeRecipients(globalData: Buffer): PublicKey[] {
  const out: PublicKey[] = [];
  if (globalData.length < GLOBAL_OFFSET_RESERVED_FEE_RECIPIENTS_START + GLOBAL_FEE_RECIPIENT_POOL_LEN * 32) {
    return out;
  }
  if (pubkeySliceNonZero(globalData, GLOBAL_OFFSET_RESERVED_FEE_RECIPIENT)) {
    out.push(
      new PublicKey(
        globalData.subarray(
          GLOBAL_OFFSET_RESERVED_FEE_RECIPIENT,
          GLOBAL_OFFSET_RESERVED_FEE_RECIPIENT + 32
        )
      )
    );
  }
  for (let i = 0; i < GLOBAL_FEE_RECIPIENT_POOL_LEN; i++) {
    const start = GLOBAL_OFFSET_RESERVED_FEE_RECIPIENTS_START + i * 32;
    if (pubkeySliceNonZero(globalData, start)) {
      out.push(new PublicKey(globalData.subarray(start, start + 32)));
    }
  }
  return out;
}

/**
 * Pump buy/sell `fee_recipient` account: standard vs mayhem pool from on-chain Global.
 * Matches `@pump-fun/pump-sdk` `getFeeRecipient` behavior (random eligible recipient).
 */
export function selectPumpTradeFeeRecipient(
  globalData: Buffer,
  isMayhemMode: boolean
): PublicKey {
  const candidates = isMayhemMode
    ? collectPumpReservedFeeRecipients(globalData)
    : collectPumpStandardFeeRecipients(globalData);
  if (candidates.length === 0) {
    throw new Error(
      isMayhemMode
        ? "Pump Global has no reserved fee recipients for mayhem trades"
        : "Pump Global has no standard fee recipients"
    );
  }
  return candidates[randomInt(candidates.length)]!;
}

/** Current pump.fun protocol fee recipient (from on-chain Global). Do not hardcode; it changes. */
export async function fetchPumpGlobalFeeRecipient(): Promise<PublicKey> {
  const connection = getSolanaConnection();
  const [globalPDA] = PublicKey.findProgramAddressSync(
    [GLOBAL_SEED],
    PUMP_PROGRAM_ID
  );
  const globalAccountInfo = await connection.getAccountInfo(globalPDA, "confirmed");
  if (!globalAccountInfo?.data) {
    throw new Error("Failed to fetch Pump.fun global account for fee recipient");
  }
  return readPumpGlobalFeeRecipient(globalAccountInfo.data);
}

export async function fetchInitialBondingCurveState(): Promise<BondingCurveState> {
  const connection = getSolanaConnection();
  const [globalPDA] = PublicKey.findProgramAddressSync(
    [GLOBAL_SEED],
    PUMP_PROGRAM_ID
  );
  const globalAccountInfo = await connection.getAccountInfo(globalPDA);
  if (!globalAccountInfo || !globalAccountInfo.data) {
    throw new Error("Failed to fetch Pump.fun global account");
  }
  const data = globalAccountInfo.data;
  // `Global` Borsh layout (see `data/pump.json`): 8-byte disc + bool + 2 pubkeys, then
  // initialVirtualTokenReserves / initialVirtualSolReserves / initialRealTokenReserves.
  const virtualTokenReserves = data.readBigUInt64LE(73);
  const virtualSolReserves = data.readBigUInt64LE(81);
  const realTokenReserves = data.readBigUInt64LE(89);

  logger.info("Initial bonding curve state fetched", {
    virtualTokenReserves: virtualTokenReserves.toString(),
    virtualSolReserves: virtualSolReserves.toString(),
    realTokenReserves: realTokenReserves.toString(),
  });

  return { virtualSolReserves, virtualTokenReserves, realTokenReserves };
}

export function derivePumpAddresses(mint: PublicKey) {
  const [global] = PublicKey.findProgramAddressSync(
    [GLOBAL_SEED],
    PUMP_PROGRAM_ID
  );
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [BONDING_CURVE_SEED, mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [MINT_AUTHORITY_SEED],
    PUMP_PROGRAM_ID
  );

  return {
    global,
    bondingCurve,
    mintAuthority,
  };
}

export function deriveMayhemCreateV2Accounts(mint: PublicKey) {
  const [globalParams] = PublicKey.findProgramAddressSync(
    [GLOBAL_PARAMS_SEED],
    MAYHEM_PROGRAM_ID
  );
  const [solVault] = PublicKey.findProgramAddressSync(
    [SOL_VAULT_SEED],
    MAYHEM_PROGRAM_ID
  );
  const [mayhemState] = PublicKey.findProgramAddressSync(
    [MAYHEM_STATE_SEED, mint.toBuffer()],
    MAYHEM_PROGRAM_ID
  );
  const mayhemTokenVault = getAssociatedTokenAddressSync(
    mint,
    solVault,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  return {
    globalParams,
    solVault,
    mayhemState,
    mayhemTokenVault,
  };
}

export async function getTokenProgramIdForPumpMint(
  mint: PublicKey
): Promise<PublicKey> {
  const connection = getSolanaConnection();
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) {
    throw new Error(`Mint account not found: ${mint.toBase58()}`);
  }
  if (
    !info.owner.equals(TOKEN_PROGRAM_ID) &&
    !info.owner.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    logger.warn("Unexpected mint owner for pump token", {
      mint: mint.toBase58(),
      owner: info.owner.toBase58(),
    });
  }
  return info.owner;
}

async function assertPumpCreateV2GlobalAllows(
  connection: ReturnType<typeof getSolanaConnection>,
  globalPk: PublicKey,
  isMayhemMode: boolean
) {
  const globalAccountInfo = await connection.getAccountInfo(globalPk, "confirmed");
  if (!globalAccountInfo?.data || globalAccountInfo.data.length < GLOBAL_OFFSET_MAYHEM_MODE_ENABLED + 1) {
    throw new AppError(
      "Could not read pump global account for create v2 preflight.",
      503
    );
  }
  const data = globalAccountInfo.data;
  const createV2Enabled = data.readUInt8(GLOBAL_OFFSET_CREATE_V2_ENABLED) !== 0;
  const mayhemModeEnabled = data.readUInt8(GLOBAL_OFFSET_MAYHEM_MODE_ENABLED) !== 0;
  if (!createV2Enabled) {
    throw new AppError(
      "Token creation is temporarily unavailable: create v2 is disabled on pump.fun.",
      503
    );
  }
  if (isMayhemMode && !mayhemModeEnabled) {
    throw new AppError(
      "Mayhem mode is disabled on pump.fun for new coins right now.",
      400
    );
  }
}

export type CreateTokenWithNewIdlOptions = {
  isMayhemMode?: boolean;
  /** Pump `OptionBool` (IDL struct); default false (cashback off). */
  isCashbackEnabled?: boolean;
};

export async function createTokenWithNewIdl(
  program: Program,
  creator: Keypair,
  mint: Keypair,
  metadata: CreateTokenMetadata,
  metadataUri: string,
  options?: CreateTokenWithNewIdlOptions
): Promise<Transaction> {
  const isMayhemMode = options?.isMayhemMode ?? false;
  const isCashbackEnabled = options?.isCashbackEnabled ?? false;

  const addresses = derivePumpAddresses(mint.publicKey);

  const associatedBondingCurve = getAssociatedTokenAddressSync(
    mint.publicKey,
    addresses.bondingCurve,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const mayhemAccounts = deriveMayhemCreateV2Accounts(mint.publicKey);

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM_ID
  );

  if (!metadata || !metadata.name || !metadata.symbol) {
    throw new Error(
      `Missing required metadata: metadata=${!!metadata}, name=${metadata?.name}, symbol=${metadata?.symbol}`
    );
  }

  if (
    !metadataUri ||
    typeof metadataUri !== "string" ||
    metadataUri.trim().length === 0
  ) {
    throw new Error(
      `Invalid metadataUri: ${metadataUri} (type: ${typeof metadataUri})`
    );
  }

  if (!creator || !creator.publicKey) {
    throw new Error("Creator keypair is invalid");
  }

  if (!mint || !mint.publicKey) {
    throw new Error("Mint keypair is invalid");
  }

  try {
    const connection = getSolanaConnection();
    const mintAccountInfo = await connection.getAccountInfo(mint.publicKey);
    if (mintAccountInfo) {
      const error = new Error(
        `Mint account ${mint.publicKey.toBase58()} already exists on-chain. ` +
          `Generate a new mint keypair before creating a token.`
      );
      logger.error("Mint account already exists", {
        mint: mint.publicKey.toBase58(),
        lamports: mintAccountInfo.lamports,
      });
      throw error;
    }
    logger.info("Mint account does not exist", {
      mint: mint.publicKey.toBase58(),
    });
  } catch (checkError) {
    const err =
      checkError instanceof Error ? checkError : new Error(String(checkError));
    if (err.message.includes("already exists")) {
      throw err;
    }
    logger.warn("Mint account existence check failed", err.message);
  }

  if (!(creator.publicKey instanceof PublicKey)) {
    throw new Error(
      `Creator publicKey is not a PublicKey instance: ${typeof creator.publicKey}`
    );
  }

  if (
    !addresses.global ||
    !addresses.bondingCurve ||
    !addresses.mintAuthority
  ) {
    throw new Error(
      `Failed to derive required PDAs: global=${!!addresses.global}, bondingCurve=${!!addresses.bondingCurve}, mintAuthority=${!!addresses.mintAuthority}`
    );
  }

  if (!associatedBondingCurve || !eventAuthority) {
    throw new Error(
      `Failed to derive PDAs: associatedBondingCurve=${!!associatedBondingCurve}, eventAuthority=${!!eventAuthority}`
    );
  }

  const allAccounts = {
    mint: mint.publicKey,
    mintAuthority: addresses.mintAuthority,
    bondingCurve: addresses.bondingCurve,
    associatedBondingCurve,
    global: addresses.global,
    user: creator.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    mayhemProgramId: MAYHEM_PROGRAM_ID,
    globalParams: mayhemAccounts.globalParams,
    solVault: mayhemAccounts.solVault,
    mayhemState: mayhemAccounts.mayhemState,
    mayhemTokenVault: mayhemAccounts.mayhemTokenVault,
    eventAuthority,
    program: PUMP_PROGRAM_ID,
  };

  for (const [key, value] of Object.entries(allAccounts)) {
    if (!value || !(value instanceof PublicKey)) {
      throw new Error(
        `Account ${key} is not a valid PublicKey: ${value} (type: ${typeof value})`
      );
    }
  }

  try {
    const connection = getSolanaConnection();
    const creatorBalance = await connection.getBalance(creator.publicKey);
    const MIN_REQUIRED_SOL = 0.02; // Reduced from 0.03 to 0.02 SOL - actual cost is ~0.0195 SOL
    const MIN_REQUIRED_LAMPORTS = MIN_REQUIRED_SOL * 1e9;

    logger.info("Creator balance check", {
      creator: creator.publicKey.toBase58(),
      balanceSol: creatorBalance / 1e9,
      balanceLamports: creatorBalance,
      minRequiredSol: MIN_REQUIRED_SOL,
      minRequiredLamports: MIN_REQUIRED_LAMPORTS,
    });

    if (creatorBalance < MIN_REQUIRED_LAMPORTS) {
      const shortfall = MIN_REQUIRED_LAMPORTS - creatorBalance;
      const isVeryClose = shortfall < 5000000;

      if (isVeryClose) {
        logger.warn("Creator balance below minimum (close)", {
          balanceSol: Number((creatorBalance / 1e9).toFixed(9)),
          minRequiredSol: MIN_REQUIRED_SOL,
          shortfallSol: Number((shortfall / 1e9).toFixed(9)),
        });
      } else {
        throw new AppError(
          `Insufficient funds: creator wallet has ${(creatorBalance / 1e9).toFixed(9)} SOL, ` +
            `needs at least ${MIN_REQUIRED_SOL} SOL. Shortfall: ${(shortfall / 1e9).toFixed(9)} SOL. ` +
            `Please fund the creator wallet before creating token.`,
          400
        );
      }
    }

    const RENT_EXEMPT_MINIMUM = 890880; // ~0.00089 SOL
    const availableForTransaction = creatorBalance - RENT_EXEMPT_MINIMUM;
    const ESTIMATED_TOTAL_COST = 19500000; // ~0.0195 SOL (mint + ATA + metadata + fees)

    if (availableForTransaction < ESTIMATED_TOTAL_COST) {
      const actualShortfall = ESTIMATED_TOTAL_COST - availableForTransaction;
      logger.warn("Creator balance may be insufficient after rent reserve", {
        balanceSol: Number((creatorBalance / 1e9).toFixed(9)),
        availableSol: Number((availableForTransaction / 1e9).toFixed(9)),
        estimatedCostSol: Number((ESTIMATED_TOTAL_COST / 1e9).toFixed(9)),
        potentialShortfallSol: Number((actualShortfall / 1e9).toFixed(9)),
      });
    }

    logger.info("Creator balance sufficient", {
      balanceSol: Number((creatorBalance / 1e9).toFixed(9)),
      minRequiredSol: MIN_REQUIRED_SOL,
    });
  } catch (balanceError) {
    const err =
      balanceError instanceof Error
        ? balanceError
        : new Error(String(balanceError));
    logger.warn("Creator balance check failed", err.message);
    throw err;
  }

  try {
    logger.info("Building create instruction");
    logger.info("Create inputs", {
      mint: mint.publicKey.toBase58(),
      creator: creator.publicKey.toBase58(),
      metadataUri,
    });

    const name = String(metadata.name || "").trim();
    const symbol = String(metadata.symbol || "").trim();
    const uri = String(metadataUri || "").trim();
    const creatorPubkey = creator.publicKey;

    if (!name || !symbol || !uri) {
      throw new Error(
        `Invalid arguments: name="${name}", symbol="${symbol}", uri="${uri}"`
      );
    }

    if (!creatorPubkey || !(creatorPubkey instanceof PublicKey)) {
      throw new Error(`Invalid creator publicKey: ${creatorPubkey}`);
    }

    logger.info("Create args validated", {
      name,
      symbol,
      uri: uri.substring(0, 50) + "...",
      creator: creatorPubkey.toBase58(),
      isMayhemMode,
      isCashbackEnabled,
    });

    const connection = getSolanaConnection();
    await assertPumpCreateV2GlobalAllows(
      connection,
      addresses.global,
      isMayhemMode
    );

    const optionCashback = { _0: isCashbackEnabled };
    const tx = await program.methods
      .createV2(name, symbol, uri, creatorPubkey, isMayhemMode, optionCashback)
      .accounts(allAccounts)
      .signers([mint])
      .transaction();

    tx.feePayer = creatorPubkey;

    logger.info("Create transaction built", {
      instructionCount: tx.instructions.length,
      feePayer: tx.feePayer?.toBase58(),
    });
    return tx;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    const errorDetails =
      typeof err === "object" && err !== null
        ? (err as { name?: string; code?: string })
        : {};
    logger.error("Create transaction build failed", err);
    logger.error("Create error details", {
      message: err.message,
      stack: err.stack,
      name: errorDetails.name,
      code: errorDetails.code,
    });

    throw err;
  }
}

const FEE_CONFIG_SEED_BYTES = Buffer.from([
  1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170,
  81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176,
]);

function encodeU64LE(value: bigint): Buffer {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64LE(value, 0);
  return buf;
}

export async function buyTokensWithNewIdl(
  buyer: Keypair,
  mint: PublicKey,
  solAmountLamports: bigint,
  creator?: PublicKey,
  minTokensOut?: bigint,
  /** Encoded as pump `OptionBool` on `buyExactSolIn` (Borsh: one byte). Default true for volume tracking. */
  trackVolume: boolean = true,
  buyOptions?: { isMayhemMode?: boolean }
): Promise<Transaction> {
  const addresses = derivePumpAddresses(mint);
  const connection = getSolanaConnection();
  const [globalAccount, bondingCurveAccountEarly] = await Promise.all([
    connection.getAccountInfo(addresses.global, "confirmed"),
    connection.getAccountInfo(addresses.bondingCurve, "confirmed"),
  ]);
  if (!globalAccount?.data) {
    throw new Error("Failed to fetch Pump.fun global account for fee recipient");
  }
  let isMayhemMode = buyOptions?.isMayhemMode;
  if (isMayhemMode === undefined) {
    isMayhemMode =
      bondingCurveAccountEarly?.data != null &&
      readBondingCurveIsMayhemMode(bondingCurveAccountEarly.data);
  }
  const feeRecipient = selectPumpTradeFeeRecipient(
    globalAccount.data,
    isMayhemMode
  );

  let tokenProgramId: PublicKey;
  try {
    tokenProgramId = await getTokenProgramIdForPumpMint(mint);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (creator && msg.includes("Mint account not found")) {
      tokenProgramId = TOKEN_2022_PROGRAM_ID;
      logger.info("Mint not on-chain yet; using Token-2022 for pump buy (create+buy bundle)", {
        mint: mint.toBase58(),
      });
    } else {
      throw err;
    }
  }
  const associatedUser = await getAssociatedTokenAddress(
    mint,
    buyer.publicKey,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  let ataExists = false;
  try {
    await getAccount(connection, associatedUser, "confirmed", tokenProgramId);
    ataExists = true;
    logger.info("ATA exists and initialized", associatedUser.toBase58());
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (
      err.message.includes("could not find account") ||
      (err as { name?: string }).name === "TokenAccountNotFoundError"
    ) {
      logger.info("ATA missing, will create", associatedUser.toBase58());
    } else if (err.message.includes("Invalid account owner")) {
      logger.info("ATA exists but not initialized, will create", associatedUser.toBase58());
    } else {
      logger.info("ATA check failed, will create", associatedUser.toBase58());
    }
  }

  logger.info("Bundle mode status", {
    creatorProvided: !!creator,
    ataInitialized: ataExists,
  });

  let creatorPubkey: PublicKey;
  try {
    const bondingCurveAccountInfo = bondingCurveAccountEarly;
    if (!bondingCurveAccountInfo || !bondingCurveAccountInfo.data) {
      if (creator) {
        creatorPubkey = creator;
        logger.info("Bonding curve missing; using provided creator", creatorPubkey.toBase58());
      } else {
        throw new Error("Bonding curve not found and no creator provided.");
      }
    } else {
      // BondingCurve: 8 disc + 5×u64 + bool + creator pubkey (see `data/pump.json`).
      const creatorBytes = bondingCurveAccountInfo.data.slice(49, 81);
      creatorPubkey = new PublicKey(creatorBytes);
      logger.info("Creator fetched from bonding curve", creatorPubkey.toBase58());
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (creator) {
      creatorPubkey = creator;
      logger.info("Using provided creator fallback", creatorPubkey.toBase58());
    } else {
      throw new Error(`Cannot determine token creator. Error: ${err.message}`);
    }
  }

  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creatorPubkey.toBuffer()],
    PUMP_PROGRAM_ID
  );

  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      addresses.bondingCurve.toBuffer(),
      tokenProgramId.toBuffer(),
      mint.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM_ID
  );

  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM_ID
  );

  const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), buyer.publicKey.toBuffer()],
    PUMP_PROGRAM_ID
  );

  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), FEE_CONFIG_SEED_BYTES],
    FEE_PROGRAM_ID
  );

  const [bondingCurveV2] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve-v2"), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );

  logger.info("Building buy_exact_sol_in instruction (raw)", {
    mint: mint.toBase58(),
    buyer: buyer.publicKey.toBase58(),
    solAmountLamports: solAmountLamports.toString(),
    solAmountSol: Number(solAmountLamports) / 1e9,
    bondingCurve: addresses.bondingCurve.toBase58(),
    tokenProgram: tokenProgramId.toBase58(),
    feeRecipient: feeRecipient.toBase58(),
    isMayhemMode,
  });

  const optionBoolTrackVolume = Buffer.from([trackVolume ? 1 : 0]);
  const data = Buffer.concat([
    DISCRIMINATORS.BUY_EXACT_SOL_IN,
    encodeU64LE(solAmountLamports),
    encodeU64LE(minTokensOut ?? BigInt(1)),
    optionBoolTrackVolume,
  ]);

  const buyIx = new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: addresses.global, isSigner: false, isWritable: false },
      { pubkey: feeRecipient, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: addresses.bondingCurve, isSigner: false, isWritable: true },
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      { pubkey: associatedUser, isSigner: false, isWritable: true },
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: false },
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: feeConfig, isSigner: false, isWritable: false },
      { pubkey: FEE_PROGRAM_ID, isSigner: false, isWritable: false },
      // Not listed on some IDL exports; required on deployed program to avoid u64 overflow (6024) at buy.rs.
      { pubkey: bondingCurveV2, isSigner: false, isWritable: false },
    ],
    data,
  });

  logger.info("Raw buy_exact_sol_in instruction built", {
    accountCount: buyIx.keys.length,
    dataLength: data.length,
    trackVolume,
    bondingCurveV2: bondingCurveV2.toBase58(),
  });

  const tx = new Transaction();

  if (!ataExists) {
    logger.info("Adding ATA creation instruction");
    if (creator) {
      logger.info("Bundle mode: ATA will be created after CREATE instructions");
    }
    tx.add(
      createAssociatedTokenAccountInstruction(
        buyer.publicKey,
        associatedUser,
        buyer.publicKey,
        mint,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    logger.info("ATA creation instruction added");
  }

  tx.add(buyIx);
  tx.feePayer = buyer.publicKey;

  logger.info("Buy transaction built", {
    instructionCount: tx.instructions.length,
    feePayer: tx.feePayer?.toBase58(),
  });

  return tx;
}

export async function buildSellTransaction(
  seller: Keypair,
  mint: PublicKey,
  amount: bigint,
  minSolOutput: bigint = BigInt(0)
): Promise<Transaction> {
  const connection = getSolanaConnection();
  const addresses = derivePumpAddresses(mint);
  const tokenProgramId = await getTokenProgramIdForPumpMint(mint);
  const associatedUser = await getAssociatedTokenAddress(
    mint,
    seller.publicKey,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [bondingCurveAccountInfo, globalAccountInfo] = await Promise.all([
    connection.getAccountInfo(addresses.bondingCurve, "confirmed"),
    connection.getAccountInfo(addresses.global, "confirmed"),
  ]);
  if (!bondingCurveAccountInfo || !bondingCurveAccountInfo.data) {
    throw new Error("Cannot build sell: Bonding curve not found");
  }
  if (!globalAccountInfo?.data) {
    throw new Error("Cannot build sell: Pump global account not found");
  }

  const bcData = bondingCurveAccountInfo.data;
  const creatorPubkey = new PublicKey(
    bcData.slice(49, 81) // BondingCurve creator field offset (see `data/pump.json`).
  );

  const isMayhemMode = readBondingCurveIsMayhemMode(bcData);
  const feeRecipient = selectPumpTradeFeeRecipient(
    globalAccountInfo.data,
    isMayhemMode
  );

  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creatorPubkey.toBuffer()],
    PUMP_PROGRAM_ID
  );

  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      addresses.bondingCurve.toBuffer(),
      tokenProgramId.toBuffer(),
      mint.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM_ID
  );

  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), FEE_CONFIG_SEED_BYTES],
    FEE_PROGRAM_ID
  );

  const [bondingCurveV2] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve-v2"), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );

  const data = Buffer.concat([
    DISCRIMINATORS.SELL,
    encodeU64LE(amount),
    encodeU64LE(minSolOutput),
  ]);

  const sellIx = new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: addresses.global, isSigner: false, isWritable: false },
      { pubkey: feeRecipient, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: addresses.bondingCurve, isSigner: false, isWritable: true },
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      { pubkey: associatedUser, isSigner: false, isWritable: true },
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: feeConfig, isSigner: false, isWritable: false },
      { pubkey: FEE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: bondingCurveV2, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction();
  tx.add(sellIx);
  tx.feePayer = seller.publicKey;

  logger.info("Sell transaction built", {
    mint: mint.toBase58(),
    seller: seller.publicKey.toBase58(),
    amount: amount.toString(),
    bondingCurveV2: bondingCurveV2.toBase58(),
  });

  return tx;
}

export async function sellTokensWithNewIdl(
  seller: Keypair,
  mint: PublicKey,
  amount: BN,
  minSolOutput: BN
): Promise<Transaction> {
  return buildSellTransaction(
    seller,
    mint,
    BigInt(amount.toString()),
    BigInt(minSolOutput.toString())
  );
}
