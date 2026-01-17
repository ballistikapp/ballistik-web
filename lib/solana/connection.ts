import { Connection } from "@solana/web3.js";

let connection: Connection | null = null;

export function getSolanaConnection() {
  if (connection) {
    return connection;
  }

  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    throw new Error("SOLANA_RPC_URL is not set");
  }

  connection = new Connection(rpcUrl, "confirmed");
  return connection;
}
