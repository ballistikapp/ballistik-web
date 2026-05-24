import "server-only";
import { type BN } from "@coral-xyz/anchor";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";

import { getPumpEventParser } from "@/server/solana/pump/idl";

interface RawTradeEventData {
  mint: PublicKey;
  user: PublicKey;
  solAmount: BN;
  tokenAmount: BN;
  isBuy: boolean;
}

export interface PumpTradeEvent {
  mint: string;
  user: string;
  isBuy: boolean;
  solAmount: number;
  tokenAmount: number;
}

export function parsePumpTradeEvents(
  tx: ParsedTransactionWithMeta,
  tokenPublicKey: string,
  tokenDecimals: number
): PumpTradeEvent[] {
  const logs = tx.meta?.logMessages;
  if (!logs?.length) return [];

  const tokenDivisor = 10 ** tokenDecimals;
  const events: PumpTradeEvent[] = [];

  try {
    for (const event of getPumpEventParser().parseLogs(logs)) {
      if (event.name !== "TradeEvent") continue;

      const data = event.data as RawTradeEventData;
      const mint = data.mint.toBase58();
      const user = data.user.toBase58();
      const solRaw = BigInt(data.solAmount.toString());
      const tokenRaw = BigInt(data.tokenAmount.toString());

      if (mint !== tokenPublicKey) {
        continue;
      }

      events.push({
        mint,
        user,
        isBuy: data.isBuy,
        solAmount: Number(solRaw) / LAMPORTS_PER_SOL,
        tokenAmount: Number(tokenRaw) / tokenDivisor,
      });
    }
  } catch {
    return [];
  }

  return events;
}
