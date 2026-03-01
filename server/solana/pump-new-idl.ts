import type { Program } from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { CreateTokenMetadata } from "pumpdotfun-sdk";

import { getSolanaConnection } from "@/lib/solana/connection";
import { logger } from "@/lib/logger";
import { AppError } from "@/server/errors";
import { PUMP_PROGRAM_ID } from "@/server/solana/pump-idl";

const GLOBAL_SEED = Buffer.from("global");
const BONDING_CURVE_SEED = Buffer.from("bonding-curve");
const MINT_AUTHORITY_SEED = Buffer.from("mint-authority");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
const FEE_PROGRAM_ID = new PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
);

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

export async function createTokenWithNewIdl(
  program: Program,
  creator: Keypair,
  mint: Keypair,
  metadata: CreateTokenMetadata,
  metadataUri: string
): Promise<Transaction> {
  const addresses = derivePumpAddresses(mint.publicKey);

  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      addresses.bondingCurve.toBuffer(),
      Buffer.from([
        6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121,
        172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0,
        169,
      ]),
      mint.publicKey.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.publicKey.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

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

  if (!associatedBondingCurve || !metadataPDA || !eventAuthority) {
    throw new Error(
      `Failed to derive PDAs: associatedBondingCurve=${!!associatedBondingCurve}, metadataPDA=${!!metadataPDA}, eventAuthority=${!!eventAuthority}`
    );
  }

  const allAccounts = {
    mint: mint.publicKey,
    mintAuthority: addresses.mintAuthority,
    bondingCurve: addresses.bondingCurve,
    associatedBondingCurve,
    global: addresses.global,
    mplTokenMetadata: TOKEN_METADATA_PROGRAM_ID,
    metadata: metadataPDA,
    user: creator.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
    eventAuthority,
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
    });
    const tx = await program.methods
      .create(name, symbol, uri, creatorPubkey)
      .accounts({
        mint: mint.publicKey,
        associatedBondingCurve,
        metadata: metadataPDA,
        user: creatorPubkey,
      })
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
  minTokensOut?: bigint
): Promise<Transaction> {
  const addresses = derivePumpAddresses(mint);
  const associatedUser = await getAssociatedTokenAddress(mint, buyer.publicKey);

  let ataExists = false;
  try {
    const connection = getSolanaConnection();
    await getAccount(connection, associatedUser, "confirmed");
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

  const feeRecipient = new PublicKey(
    "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"
  );

  let creatorPubkey: PublicKey;
  try {
    const connection = getSolanaConnection();
    const bondingCurveAccountInfo = await connection.getAccountInfo(
      addresses.bondingCurve
    );
    if (!bondingCurveAccountInfo || !bondingCurveAccountInfo.data) {
      if (creator) {
        creatorPubkey = creator;
        logger.info("Bonding curve missing; using provided creator", creatorPubkey.toBase58());
      } else {
        throw new Error("Bonding curve not found and no creator provided.");
      }
    } else {
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
      TOKEN_PROGRAM_ID.toBuffer(),
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
  });

  const data = Buffer.concat([
    DISCRIMINATORS.BUY_EXACT_SOL_IN,
    encodeU64LE(solAmountLamports),
    encodeU64LE(minTokensOut ?? BigInt(1)),
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
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: false },
      { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
      { pubkey: feeConfig, isSigner: false, isWritable: false },
      { pubkey: FEE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: bondingCurveV2, isSigner: false, isWritable: false },
    ],
    data,
  });

  logger.info("Raw buy_exact_sol_in instruction built", {
    accountCount: buyIx.keys.length,
    dataLength: data.length,
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
        TOKEN_PROGRAM_ID,
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
  const associatedUser = await getAssociatedTokenAddress(mint, seller.publicKey);

  const bondingCurveAccountInfo = await connection.getAccountInfo(
    addresses.bondingCurve
  );
  if (!bondingCurveAccountInfo || !bondingCurveAccountInfo.data) {
    throw new Error("Cannot build sell: Bonding curve not found");
  }

  const bcData = bondingCurveAccountInfo.data;
  const creatorPubkey = new PublicKey(bcData.slice(49, 81));

  const feeRecipient = new PublicKey(
    "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"
  );

  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creatorPubkey.toBuffer()],
    PUMP_PROGRAM_ID
  );

  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      addresses.bondingCurve.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
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
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
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
