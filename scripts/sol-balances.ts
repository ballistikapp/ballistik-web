#!/usr/bin/env tsx

import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";

dotenv.config({ quiet: true });

type BalanceResult = {
  publicKey: string;
  sol: number | null;
  error?: string;
};

const args = process.argv.slice(2);
let rpcUrl: string | undefined;
let filePath: string | undefined;
const directKeys: string[] = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--rpc" || arg === "-r") {
    rpcUrl = args[i + 1];
    i += 1;
    continue;
  }
  if (arg === "--file" || arg === "-f") {
    filePath = args[i + 1];
    i += 1;
    continue;
  }
  directKeys.push(arg);
}

const fileKeys: string[] = [];
if (filePath) {
  const resolved = resolve(filePath);
  const content = readFileSync(resolved, "utf8");
  const tokens = content.split(/[\s,]+/).filter(Boolean);
  fileKeys.push(...tokens);
}

const keys = [...directKeys, ...fileKeys];

if (keys.length === 0) {
  console.error(
    "Usage: tsx scripts/sol-balances.ts --rpc <url> --file <path> <pubkey...>"
  );
  console.error(
    "Example: tsx scripts/sol-balances.ts -r https://... -f keys.txt"
  );
  process.exit(1);
}

const finalRpcUrl = rpcUrl || process.env.SOLANA_RPC_URL;

if (!finalRpcUrl) {
  console.error(
    "Missing RPC URL. Provide --rpc or set SOLANA_RPC_URL in the environment."
  );
  process.exit(1);
}

const results: BalanceResult[] = [];
const validKeys: string[] = [];

for (const key of keys) {
  try {
    const normalized = new PublicKey(key).toBase58();
    validKeys.push(normalized);
  } catch (error) {
    results.push({
      publicKey: key,
      sol: null,
      error: "invalid public key",
    });
  }
}

const connection = new Connection(finalRpcUrl, "confirmed");
const chunkSize = 100;

for (let i = 0; i < validKeys.length; i += chunkSize) {
  const chunk = validKeys.slice(i, i + chunkSize);
  const pubkeys = chunk.map((key) => new PublicKey(key));
  const infos = await connection.getMultipleAccountsInfo(pubkeys, "confirmed");
  infos.forEach((info, index) => {
    const publicKey = chunk[index];
    if (!info) {
      results.push({ publicKey, sol: null });
      return;
    }
    results.push({
      publicKey,
      sol: info.lamports / LAMPORTS_PER_SOL,
    });
  });
}

console.log(`RPC: ${finalRpcUrl}`);
console.log(`Keys: ${results.length}`);
console.log("");

for (const result of results) {
  if (result.error) {
    console.log(`${result.publicKey}\tERROR\t${result.error}`);
    continue;
  }
  if (result.sol === null) {
    console.log(`${result.publicKey}\tNOT_FOUND`);
    continue;
  }
  console.log(`${result.publicKey}\t${result.sol}`);
}
