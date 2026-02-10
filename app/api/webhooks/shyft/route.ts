import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { grpcManager } from "@/server/solana/grpc-manager";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import type { RefreshScope } from "@/lib/generated/prisma/enums";

type ShyftCallbackPayload = {
  type?: string;
  status?: string;
  actions?: Array<{
    type?: string;
    info?: Record<string, unknown>;
    source_protocol?: string;
  }>;
  signatures?: string[];
  accounts?: string[];
  timestamp?: string;
  fee?: number;
  fee_payer?: string;
  protocol?: Record<string, unknown>;
  native_transfers?: Array<{
    from_address?: string;
    to_address?: string;
    amount?: number;
  }>;
  token_transfers?: Array<{
    from_address?: string;
    to_address?: string;
    token_address?: string;
    amount?: number;
  }>;
};

function extractAffectedAddresses(payload: ShyftCallbackPayload): Set<string> {
  const addresses = new Set<string>();

  payload.native_transfers?.forEach((transfer) => {
    if (transfer.from_address) addresses.add(transfer.from_address);
    if (transfer.to_address) addresses.add(transfer.to_address);
  });

  payload.token_transfers?.forEach((transfer) => {
    if (transfer.from_address) addresses.add(transfer.from_address);
    if (transfer.to_address) addresses.add(transfer.to_address);
  });

  payload.accounts?.forEach((account) => addresses.add(account));

  return addresses;
}

function extractTokenAddresses(payload: ShyftCallbackPayload): Set<string> {
  const tokens = new Set<string>();
  payload.token_transfers?.forEach((transfer) => {
    if (transfer.token_address) tokens.add(transfer.token_address);
  });
  return tokens;
}

function resolveScopes(payload: ShyftCallbackPayload): RefreshScope[] {
  const scopes: RefreshScope[] = [];
  if (payload.type === "SWAP" || payload.type === "TOKEN_TRANSFER") {
    scopes.push("TRANSACTIONS", "HOLDINGS");
  }
  if (payload.type === "SOL_TRANSFER") {
    scopes.push("WALLETS");
  }
  if (scopes.length === 0) {
    scopes.push("TRANSACTIONS", "HOLDINGS", "WALLETS");
  }
  return scopes;
}

async function invalidateCaches(
  walletAddresses: Set<string>,
  tokenAddresses: Set<string>,
  scopes: RefreshScope[]
) {
  if (walletAddresses.size === 0) return 0;

  const wallets = await prisma.wallet.findMany({
    where: { publicKey: { in: Array.from(walletAddresses) } },
    select: { publicKey: true, userId: true, tokenPublicKey: true },
  });

  if (wallets.length === 0) return 0;

  const tokenPubkeys = new Set<string>();
  for (const w of wallets) {
    if (w.tokenPublicKey) tokenPubkeys.add(w.tokenPublicKey);
  }
  for (const t of tokenAddresses) {
    tokenPubkeys.add(t);
  }

  let touchCount = 0;
  for (const wallet of wallets) {
    if (!wallet.userId) continue;
    const tokensToTouch = wallet.tokenPublicKey
      ? [wallet.tokenPublicKey]
      : Array.from(tokenPubkeys);

    for (const tokenPublicKey of tokensToTouch) {
      for (const scope of scopes) {
        try {
          await refreshCacheService.touch({
            userId: wallet.userId,
            tokenPublicKey,
            scope,
          });
          touchCount += 1;
        } catch {
          // best-effort
        }
      }
    }
  }

  return touchCount;
}

export async function POST(request: Request) {
  try {
    const env = getEnv();
    const callbackSecret = env.SHYFT_CALLBACK_SECRET;

    if (callbackSecret) {
      const apiKeyHeader = request.headers.get("x-api-key");
      if (apiKeyHeader !== callbackSecret) {
        logger.warn("Shyft callback: invalid x-api-key header");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const payload = (await request.json()) as ShyftCallbackPayload;
    const walletAddresses = extractAffectedAddresses(payload);
    const tokenAddresses = extractTokenAddresses(payload);
    const scopes = resolveScopes(payload);

    if (walletAddresses.size > 0) {
      const touchCount = await invalidateCaches(walletAddresses, tokenAddresses, scopes);
      logger.info("Shyft callback: cache invalidated", {
        type: payload.type,
        accountCount: walletAddresses.size,
        scopes,
        touchCount,
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Shyft callback: processing failed", { errorMessage: message });
    return NextResponse.json(
      { error: "Processing failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    connected: grpcManager.isConnected(),
  });
}
