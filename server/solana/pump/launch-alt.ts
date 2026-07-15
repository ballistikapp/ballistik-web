import "server-only";
import {
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { getSolanaConnection } from "@/lib/solana/connection";
import { logger } from "@/lib/logger";
import { PUMP_PROGRAM_ID } from "@/server/solana/pump/idl";
import {
  derivePumpAddresses,
  deriveMayhemCreateV2Accounts,
  MAYHEM_PROGRAM_ID,
} from "@/server/solana/pump/instructions";
import { getBuybackFeeRecipients, getGlobalSnapshot } from "@/server/solana/pump/global-account";

const EXTEND_CHUNK_SIZE = 20;
const ALT_PROPAGATION_POLL_INTERVAL_MS = 400;
const ALT_PROPAGATION_MAX_WAIT_MS = 10_000;

/**
 * Every address a launch's create+buy bundle transactions might reference for
 * this mint/creator, so building buy instructions later (which pick a random
 * fee recipient per call) always resolves to an address already in the ALT.
 */
export async function computeLaunchAltAddresses(
  mint: PublicKey,
  creator: PublicKey,
  options?: { isMayhemMode?: boolean }
): Promise<PublicKey[]> {
  const isMayhemMode = options?.isMayhemMode ?? false;
  const pumpAddresses = derivePumpAddresses(mint);
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), creator.toBuffer()],
    PUMP_PROGRAM_ID
  );

  const tokenProgramId = isMayhemMode ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [pumpAddresses.bondingCurve.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [buybackRecipients, globalSnapshot] = await Promise.all([
    getBuybackFeeRecipients(),
    getGlobalSnapshot(),
  ]);

  const addresses: PublicKey[] = [
    mint,
    pumpAddresses.bondingCurve,
    pumpAddresses.bondingCurveV2,
    associatedBondingCurve,
    creatorVault,
    tokenProgramId,
    ...buybackRecipients,
  ];

  if (isMayhemMode) {
    const mayhemAccounts = deriveMayhemCreateV2Accounts(mint);
    addresses.push(
      MAYHEM_PROGRAM_ID,
      mayhemAccounts.globalParams,
      mayhemAccounts.solVault,
      mayhemAccounts.mayhemState,
      mayhemAccounts.mayhemTokenVault,
      globalSnapshot.reservedFeeRecipient,
      ...globalSnapshot.reservedFeeRecipients
    );
  }

  return addresses;
}

function dedupeAddresses(addresses: PublicKey[]): PublicKey[] {
  const seen = new Set<string>();
  return addresses.filter((pk) => {
    const key = pk.toBase58();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function waitForAltPropagation(
  altAddress: PublicKey,
  expectedCount: number,
  logContext: Record<string, unknown>
): Promise<AddressLookupTableAccount> {
  const connection = getSolanaConnection();
  const deadline = Date.now() + ALT_PROPAGATION_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const response = await connection.getAddressLookupTable(altAddress);
    if (response.value && response.value.state.addresses.length >= expectedCount) {
      return response.value;
    }
    await new Promise((resolve) => setTimeout(resolve, ALT_PROPAGATION_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Launch ALT ${altAddress.toBase58()} did not propagate within ${ALT_PROPAGATION_MAX_WAIT_MS}ms (${JSON.stringify(logContext)})`
  );
}

/**
 * Creates and populates a one-off Address Lookup Table for a single launch's
 * bundle-buy transactions, then waits for it to become readable on-chain.
 * Adds latency (a create tx + extend tx(s) + at least one slot of propagation,
 * roughly 1-2s) to the launch's create step — must run before building any
 * buy transactions that reference it.
 */
export async function createDynamicLaunchAlt(
  authority: Keypair,
  addresses: PublicKey[],
  logContext: Record<string, unknown> = {}
): Promise<AddressLookupTableAccount> {
  const connection = getSolanaConnection();
  const uniqueAddresses = dedupeAddresses(addresses);

  const slot = await connection.getSlot("finalized");
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: authority.publicKey,
    payer: authority.publicKey,
    recentSlot: slot,
  });

  logger.info("Creating dynamic launch ALT", {
    ...logContext,
    altAddress: altAddress.toBase58(),
    addressCount: uniqueAddresses.length,
  });

  const { blockhash: createBlockhash } = await connection.getLatestBlockhash("confirmed");
  const createTx = new Transaction();
  createTx.add(createIx);
  createTx.recentBlockhash = createBlockhash;
  createTx.feePayer = authority.publicKey;
  await sendAndConfirmTransaction(connection, createTx, [authority], {
    commitment: "confirmed",
  });

  for (let i = 0; i < uniqueAddresses.length; i += EXTEND_CHUNK_SIZE) {
    const chunk = uniqueAddresses.slice(i, i + EXTEND_CHUNK_SIZE);
    const { blockhash: extendBlockhash } = await connection.getLatestBlockhash("confirmed");
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
    await sendAndConfirmTransaction(connection, extendTx, [authority], {
      commitment: "confirmed",
    });
  }

  const alt = await waitForAltPropagation(altAddress, uniqueAddresses.length, logContext);
  logger.info("Dynamic launch ALT ready", {
    ...logContext,
    altAddress: altAddress.toBase58(),
    addressCount: alt.state.addresses.length,
  });
  return alt;
}
