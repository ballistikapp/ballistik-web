#!/usr/bin/env tsx
/**
 * One-off script to create and populate the Address Lookup Table (ALT) used
 * by the non-bundled launch path (combined CREATE + dev BUY versioned tx).
 *
 * Usage:
 *   tsx scripts/create-launch-alt.ts
 *
 * Requires SOLANA_RPC_URL and SYSTEM_DEV_WALLET_PRIVATE_KEY in the environment.
 * LAUNCH_LOOKUP_TABLE_ADDRESS must NOT be set — if it is, the script aborts to
 * prevent creating duplicate tables.
 *
 * After the script completes, set LAUNCH_LOOKUP_TABLE_ADDRESS to the printed
 * address in your .env file.
 */

import * as dotenv from "dotenv";
import { join } from "path";

dotenv.config({ path: join(process.cwd(), ".env"), quiet: true });
dotenv.config({ path: join(process.cwd(), ".env.local"), quiet: true });
dotenv.config({
  path: join(process.cwd(), ".env.development.local"),
  override: false,
  quiet: true,
});

import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
const FEE_PROGRAM_ID = new PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
);
const FEE_RECIPIENT = new PublicKey(
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"
);
const GLOBAL_SEED = Buffer.from("global");
const MINT_AUTHORITY_SEED = Buffer.from("mint-authority");
const FEE_CONFIG_SEED_BYTES = Buffer.from([
  1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170,
  81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176,
]);

const DISCRIMINATOR_SIZE = 8;
const PUBKEY_SIZE = 32;
const U64_SIZE = 8;
const BOOL_SIZE = 1;

function deriveStaticPdas() {
  const [global] = PublicKey.findProgramAddressSync(
    [GLOBAL_SEED],
    PUMP_PROGRAM_ID
  );
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [MINT_AUTHORITY_SEED],
    PUMP_PROGRAM_ID
  );
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    PUMP_PROGRAM_ID
  );
  const [globalVolumeAccumulator] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_volume_accumulator")],
    PUMP_PROGRAM_ID
  );
  const [feeConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), FEE_CONFIG_SEED_BYTES],
    FEE_PROGRAM_ID
  );
  return { global, mintAuthority, eventAuthority, globalVolumeAccumulator, feeConfig };
}

function decodeGlobalBuybackRecipients(data: Buffer): PublicKey[] {
  let offset = DISCRIMINATOR_SIZE;
  offset += BOOL_SIZE;
  offset += PUBKEY_SIZE;
  offset += PUBKEY_SIZE;
  offset += U64_SIZE * 4;
  offset += U64_SIZE; // feeBasisPoints
  offset += PUBKEY_SIZE;
  offset += BOOL_SIZE;
  offset += U64_SIZE;
  offset += U64_SIZE; // creatorFeeBasisPoints
  offset += PUBKEY_SIZE * 7;
  offset += PUBKEY_SIZE;
  offset += PUBKEY_SIZE;
  offset += BOOL_SIZE;
  offset += PUBKEY_SIZE;
  offset += PUBKEY_SIZE;
  offset += BOOL_SIZE;
  offset += PUBKEY_SIZE * 7;
  offset += BOOL_SIZE;

  const recipients: PublicKey[] = [];
  for (let i = 0; i < 8; i++) {
    recipients.push(new PublicKey(data.subarray(offset, offset + PUBKEY_SIZE)));
    offset += PUBKEY_SIZE;
  }
  return recipients;
}

async function fetchBuybackRecipients(
  connection: Connection,
  globalPda: PublicKey
): Promise<PublicKey[]> {
  const info = await connection.getAccountInfo(globalPda, "confirmed");
  if (!info?.data) {
    throw new Error("Pump.fun Global account not found");
  }
  return decodeGlobalBuybackRecipients(info.data as Buffer);
}

// Solana requires extend ix to have at most 20 addresses each.
const EXTEND_CHUNK_SIZE = 20;

async function main() {
  if (process.env.LAUNCH_LOOKUP_TABLE_ADDRESS) {
    console.error(
      "ERROR: LAUNCH_LOOKUP_TABLE_ADDRESS is already set in environment.\n" +
        "Refusing to create a duplicate ALT. If you want to recreate it,\n" +
        "first clear LAUNCH_LOOKUP_TABLE_ADDRESS from your .env file."
    );
    process.exit(1);
  }

  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    console.error("ERROR: SOLANA_RPC_URL is not set.");
    process.exit(1);
  }

  const systemPrivateKey = process.env.SYSTEM_DEV_WALLET_PRIVATE_KEY;
  if (!systemPrivateKey) {
    console.error("ERROR: SYSTEM_DEV_WALLET_PRIVATE_KEY is not set.");
    process.exit(1);
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const authority = Keypair.fromSecretKey(bs58.decode(systemPrivateKey));
  console.log(`Authority: ${authority.publicKey.toBase58()}`);

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(6)} SOL`);
  if (balance < 0.01 * 1e9) {
    console.error(
      "ERROR: Authority wallet needs at least 0.01 SOL to pay for the ALT creation."
    );
    process.exit(1);
  }

  // Build the full list of static accounts
  const pdas = deriveStaticPdas();
  let buybackRecipients: PublicKey[];
  if (process.env.PUMP_BUYBACK_FEE_RECIPIENTS) {
    const parts = process.env.PUMP_BUYBACK_FEE_RECIPIENTS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length !== 8) {
      console.error(
        `ERROR: PUMP_BUYBACK_FEE_RECIPIENTS must contain exactly 8 base58 pubkeys (got ${parts.length}).`
      );
      process.exit(1);
    }
    buybackRecipients = parts.map((p) => new PublicKey(p));
    console.log(`Using ${buybackRecipients.length} buyback recipients from PUMP_BUYBACK_FEE_RECIPIENTS env.`);
  } else {
    console.log("Fetching buyback fee recipients from Global account...");
    buybackRecipients = await fetchBuybackRecipients(connection, pdas.global);
    console.log(`Found ${buybackRecipients.length} buyback recipients on chain.`);
    console.log(
      "WARNING: on-chain decode may be wrong if our IDL is out of date. Prefer setting PUMP_BUYBACK_FEE_RECIPIENTS to 8 known-good pubkeys."
    );
  }

  const staticAccounts: PublicKey[] = [
    // Programs
    PUMP_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    SYSVAR_RENT_PUBKEY,
    TOKEN_METADATA_PROGRAM_ID,
    FEE_PROGRAM_ID,
    // Pump PDAs
    pdas.global,
    pdas.mintAuthority,
    pdas.eventAuthority,
    pdas.globalVolumeAccumulator,
    pdas.feeConfig,
    // Hardcoded
    FEE_RECIPIENT,
    // Buyback recipients
    ...buybackRecipients,
  ];

  // Deduplicate (in case any recipient matches a program address)
  const seen = new Set<string>();
  const uniqueAccounts = staticAccounts.filter((pk) => {
    const key = pk.toBase58();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\nTotal unique accounts to include: ${uniqueAccounts.length}`);
  uniqueAccounts.forEach((pk, i) => console.log(`  [${i}] ${pk.toBase58()}`));

  // Step 1: create the ALT
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  // ALT createLookupTable requires `recentSlot` to be a slot the processing
  // validator has already seen. Using "confirmed" can race ahead of the leader
  // and trigger "<slot> is not a recent slot". Use "finalized" for safety.
  const slot = await connection.getSlot("finalized");

  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: authority.publicKey,
    payer: authority.publicKey,
    recentSlot: slot,
  });

  console.log(`\nCreating ALT at ${altAddress.toBase58()}...`);
  const createTx = new Transaction();
  createTx.add(createIx);
  createTx.recentBlockhash = blockhash;
  createTx.feePayer = authority.publicKey;
  const createSig = await sendAndConfirmTransaction(connection, createTx, [authority]);
  console.log(`Created. Signature: ${createSig}`);

  // Step 2: extend ALT in chunks of 20
  for (let i = 0; i < uniqueAccounts.length; i += EXTEND_CHUNK_SIZE) {
    const chunk = uniqueAccounts.slice(i, i + EXTEND_CHUNK_SIZE);
    const { blockhash: extendBlockhash } =
      await connection.getLatestBlockhash("confirmed");
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: authority.publicKey,
      authority: authority.publicKey,
      lookupTable: altAddress,
      addresses: chunk,
    });
    const extendTx = new Transaction();
    extendTx.add(extendIx);
    extendTx.recentBlockhash = extendBlockhash;
    extendTx.feePayer = authority.publicKey;
    const extendSig = await sendAndConfirmTransaction(connection, extendTx, [authority]);
    console.log(
      `Extended with ${chunk.length} addresses (${i}–${i + chunk.length - 1}). Signature: ${extendSig}`
    );
  }

  console.log("\n==========================================================");
  console.log("ALT created and populated successfully.");
  console.log(`\nSet this in your .env file:\n`);
  console.log(`LAUNCH_LOOKUP_TABLE_ADDRESS=${altAddress.toBase58()}`);
  console.log("\nNOTE: Wait at least one Solana slot (~400ms) before using");
  console.log("the ALT in transactions (Solana requirement).");
  console.log("==========================================================\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
