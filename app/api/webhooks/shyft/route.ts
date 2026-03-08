import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { grpcManager } from "@/server/solana/grpc-manager";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { refreshCacheService } from "@/server/services/refresh-cache.service";
import { transactionService } from "@/server/services/transaction.service";
import type { RefreshScope } from "@/lib/generated/prisma/enums";
import { checkReplayWindow, ensureRateLimit } from "@/server/security/api-abuse";

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
  const tokenPubkeys = new Set<string>(tokenAddresses);
  const walletList = walletAddresses.size
    ? await prisma.wallet.findMany({
        where: { publicKey: { in: Array.from(walletAddresses) } },
        select: { publicKey: true, userId: true, tokenPublicKey: true },
      })
    : [];

  for (const w of walletList) {
    if (w.tokenPublicKey) tokenPubkeys.add(w.tokenPublicKey);
  }

  const tokenList = tokenPubkeys.size
    ? await prisma.token.findMany({
        where: { publicKey: { in: Array.from(tokenPubkeys) } },
        select: { publicKey: true, userId: true },
      })
    : [];

  let touchCount = 0;
  for (const wallet of walletList) {
    if (!wallet.userId || !wallet.tokenPublicKey) continue;
    const tokensToTouch = [wallet.tokenPublicKey];

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

  for (const token of tokenList) {
    for (const scope of scopes) {
      try {
        await refreshCacheService.touch({
          userId: token.userId,
          tokenPublicKey: token.publicKey,
          scope,
        });
        touchCount += 1;
      } catch {
        // best-effort
      }
    }
  }

  return touchCount;
}

async function resolveTokenPublicKeys(payload: ShyftCallbackPayload) {
  const tokenPublicKeys = extractTokenAddresses(payload);
  const callbackAddresses = payload.accounts ?? [];
  if (callbackAddresses.length === 0) {
    return tokenPublicKeys;
  }

  const callbacks = await prisma.shyftCallback.findMany({
    where: {
      address: { in: callbackAddresses },
      projectId: { not: null },
    },
    select: { projectId: true },
  });

  callbacks.forEach((callback) => {
    if (callback.projectId) tokenPublicKeys.add(callback.projectId);
  });

  return tokenPublicKeys;
}

function resolveClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded
      .split(",")
      .map((part) => part.trim())
      .find(Boolean);
    if (first) {
      return first;
    }
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}

export async function POST(request: Request) {
  try {
    const env = getEnv();
    const callbackSecret = env.SHYFT_CALLBACK_SECRET;
    const clientIp = resolveClientIp(request.headers);

    ensureRateLimit({
      tier: "webhook",
      key: `${clientIp}:shyft`,
    });

    const maxPayloadBytes = 250_000;
    const contentLengthHeader = request.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;
    if (contentLength > maxPayloadBytes) {
      logger.warn("Shyft callback: payload too large", {
        clientIp,
        contentLength,
      });
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    if (process.env.NODE_ENV === "production" && !callbackSecret) {
      logger.error("Shyft callback: SHYFT_CALLBACK_SECRET missing in production");
      return NextResponse.json(
        { error: "Callback auth not configured" },
        { status: 500 }
      );
    }

    const apiKeyHeader = request.headers.get("x-api-key");
    if (!callbackSecret || apiKeyHeader !== callbackSecret) {
      logger.warn("Shyft callback: invalid x-api-key header", {
        clientIp,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await request.json()) as ShyftCallbackPayload;
    const replayCandidates =
      payload.signatures && payload.signatures.length > 0
        ? payload.signatures
        : [
            `${payload.type ?? "unknown"}:${payload.timestamp ?? "none"}:${payload.fee_payer ?? "none"}`,
          ];
    const isReplay = replayCandidates.some(
      (value) =>
        !checkReplayWindow({
          scope: "shyft-callback",
          value,
          windowMs: 5 * 60_000,
        })
    );
    if (isReplay) {
      logger.warn("Shyft callback: replay detected", {
        clientIp,
      });
      return NextResponse.json({ error: "Duplicate callback" }, { status: 409 });
    }

    const walletAddresses = extractAffectedAddresses(payload);
    const tokenAddresses = await resolveTokenPublicKeys(payload);
    const signatures = Array.from(new Set(payload.signatures ?? []));
    const scopes = resolveScopes(payload);

    if (signatures.length > 0 && tokenAddresses.size > 0) {
      await Promise.all(
        Array.from(tokenAddresses).map(async (tokenPublicKey) => {
          try {
            await transactionService.ingestTokenSignatures({
              tokenPublicKey,
              signatures,
            });
          } catch (error) {
            logger.warn("Shyft callback: transaction ingest failed", {
              tokenPublicKey,
              errorMessage:
                error instanceof Error ? error.message : String(error),
            });
          }
        })
      );
    }

    if (walletAddresses.size > 0 || tokenAddresses.size > 0) {
      const touchCount = await invalidateCaches(walletAddresses, tokenAddresses, scopes);
      logger.info("Shyft callback: cache invalidated", {
        type: payload.type,
        accountCount: walletAddresses.size,
        tokenCount: tokenAddresses.size,
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
