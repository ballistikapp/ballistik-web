import { AnchorProvider } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { Keypair } from "@solana/web3.js";
import { PumpFunSDK, type CreateTokenMetadata } from "pumpdotfun-sdk";
import { getSolanaConnection } from "@/lib/solana/connection";
import { sendJitoBundle } from "@/server/solana/jito-bundle";
import { buildCreateTransaction } from "@/server/solana/pump-transactions";
import { constructTxsForBuysWithCreate } from "@/server/solana/tx-aggregation";

type BundleLaunchInput = {
  creator: Keypair;
  mint: Keypair;
  metadata: CreateTokenMetadata;
  creatorBuyAmountLamport: bigint;
  buyerWallets: Keypair[];
  buyAmountsLamport: bigint[];
  tipper: Keypair;
  tipLamports: number;
  slippageBasisPoints: bigint;
};

export async function bundleCreateAndBuy(input: BundleLaunchInput) {
  const provider = new AnchorProvider(
    getSolanaConnection(),
    new NodeWallet(input.creator),
    { commitment: "finalized" }
  );
  const pumpSdk = new PumpFunSDK(provider);
  const { createTx } = await buildCreateTransaction(
    pumpSdk,
    input.creator,
    input.mint,
    input.metadata
  );

  const allBuyerWallets =
    input.creatorBuyAmountLamport > BigInt(0)
      ? [input.creator, ...input.buyerWallets]
      : input.buyerWallets;
  const allBuyAmounts =
    input.creatorBuyAmountLamport > BigInt(0)
      ? [input.creatorBuyAmountLamport, ...input.buyAmountsLamport]
      : input.buyAmountsLamport;

  const [txs, signers] = await constructTxsForBuysWithCreate(
    createTx,
    [input.creator, input.mint],
    allBuyerWallets,
    input.mint.publicKey,
    allBuyAmounts,
    input.slippageBasisPoints,
    input.creator.publicKey
  );

  return sendJitoBundle(txs, signers, input.tipper, input.tipLamports);
}
