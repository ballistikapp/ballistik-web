import {
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  type PublicKey,
  type Transaction,
} from "@solana/web3.js";
import type { CreateTokenMetadata } from "pumpdotfun-sdk";
import { getSolanaConnection } from "@/lib/solana/connection";
import { logger } from "@/lib/logger";
import {
  buildBuyTokenTransactionRaw,
  buildCreateTokenTransactionRaw,
} from "@/server/solana/pump/instructions";
import { getLaunchLookupTable } from "@/server/solana/pump/lookup-table";

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
  const createTx = await buildCreateTokenTransactionRaw(
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
  minTokensOut?: bigint
): Promise<Transaction> {
  const tx = await buildBuyTokenTransactionRaw(
    buyer,
    mint,
    buyAmountLamport,
    creator,
    minTokensOut
  );
  tx.feePayer = buyer.publicKey;
  return tx;
}

export type CreateAndDevBuyVersionedResult = {
  tx: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
};

export async function buildCreateAndDevBuyVersionedTransaction(
  creator: Keypair,
  mint: Keypair,
  metadata: PumpMetadataUpload,
  devBuyAmountLamports: bigint,
  minTokensOut: bigint = BigInt(1)
): Promise<CreateAndDevBuyVersionedResult> {
  const metadataResult = await uploadPumpMetadata(metadata);
  const metadataUri = metadataResult.metadataUri as string;

  const [createTx, buyTx, alt, { blockhash, lastValidBlockHeight }] =
    await Promise.all([
      buildCreateTokenTransactionRaw(creator, mint, metadata, metadataUri),
      buildBuyTokenTransactionRaw(
        creator,
        mint.publicKey,
        devBuyAmountLamports,
        creator.publicKey,
        minTokensOut
      ),
      getLaunchLookupTable(),
      getSolanaConnection().getLatestBlockhash("confirmed"),
    ]);

  const instructions = [
    ...createTx.instructions,
    ...buyTx.instructions,
  ];

  const message = new TransactionMessage({
    payerKey: creator.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message([alt]);

  const tx = new VersionedTransaction(message);
  tx.sign([creator, mint]);

  const serializedLength = tx.serialize().length;
  logger.info("Built versioned create+dev-buy transaction", {
    mint: mint.publicKey.toBase58(),
    creator: creator.publicKey.toBase58(),
    devBuyAmountSol: Number(devBuyAmountLamports) / 1e9,
    instructionCount: instructions.length,
    serializedBytes: serializedLength,
    altAddress: alt.key.toBase58(),
    altAddressCount: alt.state.addresses.length,
  });

  if (serializedLength > 1232) {
    logger.warn("Versioned transaction exceeds 1232 bytes despite ALT", {
      serializedBytes: serializedLength,
    });
  }

  return { tx, blockhash, lastValidBlockHeight };
}
