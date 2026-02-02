import { AnchorProvider, BN } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { Keypair, type PublicKey, type Transaction } from "@solana/web3.js";
import type { CreateTokenMetadata } from "pumpdotfun-sdk";
import { getSolanaConnection } from "@/lib/solana/connection";
import { getPumpProgram } from "@/server/solana/pump-idl";
import {
  buyTokensWithNewIdl,
  createTokenWithNewIdl,
} from "@/server/solana/pump-new-idl";

export type PumpMetadataUpload = CreateTokenMetadata & {
  bannerFile?: File | null;
};

async function uploadPumpMetadata(metadata: PumpMetadataUpload) {
  if (!(metadata.file instanceof Blob)) {
    throw new Error("File must be a Blob or File object");
  }
  const formData = new FormData();
  const fileName =
    metadata.file instanceof File && metadata.file.name
      ? metadata.file.name
      : "media";
  formData.append("file", metadata.file, fileName);
  if (metadata.bannerFile) {
    const bannerName =
      metadata.bannerFile instanceof File && metadata.bannerFile.name
        ? metadata.bannerFile.name
        : "banner.png";
    formData.append("banner", metadata.bannerFile, bannerName);
  }
  formData.append("name", metadata.name);
  formData.append("symbol", metadata.symbol);
  formData.append("description", metadata.description);
  formData.append("twitter", metadata.twitter || "");
  formData.append("telegram", metadata.telegram || "");
  formData.append("website", metadata.website || "");
  formData.append("showName", "true");
  const request = await fetch("https://pump.fun/api/ipfs", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: formData,
    credentials: "same-origin",
  });
  if (request.status === 500) {
    const errorText = await request.text();
    throw new Error(`Server error (500): ${errorText || "Unknown error"}`);
  }
  if (!request.ok) {
    throw new Error(`HTTP error! status: ${request.status}`);
  }
  const responseText = await request.text();
  if (!responseText) {
    throw new Error("Empty response received from server");
  }
  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Invalid JSON response: ${responseText}`);
  }
}

export async function buildCreateTokenTransaction(
  creator: Keypair,
  mint: Keypair,
  metadata: PumpMetadataUpload
) {
  const metadataResult = await uploadPumpMetadata(metadata);
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
