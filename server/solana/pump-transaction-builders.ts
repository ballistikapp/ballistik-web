import { AnchorProvider, BN } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { Keypair, type PublicKey, type Transaction } from "@solana/web3.js";
import type { CreateTokenMetadata, PumpFunSDK } from "pumpdotfun-sdk";
import { getSolanaConnection } from "@/lib/solana/connection";
import { getPumpProgram } from "@/server/solana/pump-idl";
import {
  buyTokensWithNewIdl,
  createTokenWithNewIdl,
} from "@/server/solana/pump-new-idl";

export async function buildCreateTokenTransaction(
  pumpSdk: PumpFunSDK,
  creator: Keypair,
  mint: Keypair,
  metadata: CreateTokenMetadata
) {
  const metadataResult = await pumpSdk.createTokenMetadata(metadata);
  const metadataUri = metadataResult.metadataUri as string;
  const provider = new AnchorProvider(
    getSolanaConnection(),
    new NodeWallet(creator),
    { commitment: "finalized" }
  );
  const program = getPumpProgram(provider);
  const createTx = await createTokenWithNewIdl(
    program,
    creator,
    mint,
    metadata,
    metadataUri
  );
  if (!createTx.feePayer) {
    createTx.feePayer = creator.publicKey;
  }
  return { createTx, metadataUri };
}

export async function buildBuyTokenTransaction(
  buyer: Keypair,
  mint: PublicKey,
  buyAmountLamport: bigint,
  creator?: PublicKey,
  minTokensOut?: BN
): Promise<Transaction> {
  const spendableLamports = new BN(buyAmountLamport.toString());
  const minOut = minTokensOut ?? new BN(1);
  const provider = new AnchorProvider(
    getSolanaConnection(),
    new NodeWallet(buyer),
    { commitment: "finalized" }
  );
  const program = getPumpProgram(provider);
  const tx = await buyTokensWithNewIdl(
    program,
    buyer,
    mint,
    spendableLamports,
    minOut,
    creator
  );
  tx.feePayer = buyer.publicKey;
  return tx;
}
