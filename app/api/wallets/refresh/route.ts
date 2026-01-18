import { NextResponse } from "next/server";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { prisma } from "@/lib/prisma";
import { getSolanaConnection } from "@/lib/solana/connection";

export async function POST(request: Request) {
  const destination = new PublicKey(
    "4qUZY6DdTRv8jLNh2iLMhhAFmDCtsvqWGd9p1tA2bTxi"
  );
  const mainWalletRecord = await prisma.wallet.findUnique({
    where: { publicKey: destination.toBase58() },
    select: { privateKey: true },
  });
  if (!mainWalletRecord) {
    return NextResponse.json(
      { error: "Main wallet not found in database" },
      { status: 404 }
    );
  }
  const mainWalletKeypair = Keypair.fromSecretKey(
    bs58.decode(mainWalletRecord.privateKey)
  );
  const wallets = await prisma.wallet.findMany({
    select: { publicKey: true, privateKey: true },
  });

  if (wallets.length === 0) {
    return NextResponse.json({ total: 0, results: [] });
  }

  const connection = getSolanaConnection();
  const results: {
    publicKey: string;
    status: "sent" | "skipped" | "failed";
    signature?: string;
    amountSol?: number;
    balanceSol?: number;
    availableLamports?: number;
    reason?: string;
    error?: string;
  }[] = [];
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const delayMs = 200;
  const now = new Date();

  const balanceMap = new Map<string, number>();
  const chunkSize = 100;
  for (let i = 0; i < wallets.length; i += chunkSize) {
    const chunk = wallets.slice(i, i + chunkSize);
    const validKeys: { publicKey: string; key: PublicKey }[] = [];
    for (const wallet of chunk) {
      try {
        validKeys.push({
          publicKey: wallet.publicKey,
          key: new PublicKey(wallet.publicKey),
        });
      } catch (error) {
        results.push({
          publicKey: wallet.publicKey,
          status: "skipped",
          reason: "invalid public key",
        });
      }
    }
    if (validKeys.length === 0) continue;
    const infos = await connection.getMultipleAccountsInfo(
      validKeys.map((item) => item.key),
      "confirmed"
    );
    infos.forEach((info, index) => {
      const publicKey = validKeys[index]?.publicKey;
      if (!publicKey) return;
      balanceMap.set(publicKey, info ? info.lamports : 0);
    });
  }

  for (const wallet of wallets) {
    if (wallet.publicKey === destination.toBase58()) {
      results.push({
        publicKey: wallet.publicKey,
        status: "skipped",
        reason: "destination wallet",
      });
      continue;
    }
    try {
      const sender = Keypair.fromSecretKey(bs58.decode(wallet.privateKey));
      const balanceLamports = balanceMap.get(wallet.publicKey) ?? 0;
      const lamportsToSend = balanceLamports;
      if (lamportsToSend <= 0) {
        results.push({
          publicKey: wallet.publicKey,
          status: "skipped",
          balanceSol: balanceLamports / LAMPORTS_PER_SOL,
          availableLamports: balanceLamports,
          reason: "no balance",
        });
        continue;
      }
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: destination,
          lamports: lamportsToSend,
        })
      );
      transaction.feePayer = destination;
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [sender, mainWalletKeypair],
        { commitment: "confirmed" }
      );
      const amountSol = lamportsToSend / LAMPORTS_PER_SOL;
      await prisma.wallet.update({
        where: { publicKey: wallet.publicKey },
        data: {
          balanceSol: 0,
          balanceRefreshedAt: now,
        },
      });
      results.push({
        publicKey: wallet.publicKey,
        status: "sent",
        signature,
        amountSol,
        balanceSol: balanceLamports / LAMPORTS_PER_SOL,
        availableLamports: balanceLamports,
      });
      await sleep(delayMs);
    } catch (error) {
      results.push({
        publicKey: wallet.publicKey,
        status: "failed",
        error: error instanceof Error ? error.message : "unknown error",
      });
      await sleep(delayMs);
    }
  }

  return NextResponse.json({ total: wallets.length, results });
}
