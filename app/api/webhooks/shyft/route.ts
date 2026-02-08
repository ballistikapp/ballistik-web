import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { grpcManager } from "@/server/solana/grpc-manager";
import { logger } from "@/lib/logger";

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

    if (payload.type === "SWAP" || payload.type === "TOKEN_TRANSFER") {
      const accounts = new Set<string>();

      payload.native_transfers?.forEach((transfer) => {
        if (transfer.from_address) accounts.add(transfer.from_address);
        if (transfer.to_address) accounts.add(transfer.to_address);
      });

      payload.token_transfers?.forEach((transfer) => {
        if (transfer.from_address) accounts.add(transfer.from_address);
        if (transfer.to_address) accounts.add(transfer.to_address);
        if (transfer.token_address) accounts.add(transfer.token_address);
      });

      if (accounts.size > 0) {
        logger.info("Shyft callback: invalidating cache", {
          type: payload.type,
          accountCount: accounts.size,
        });
      }
    }

    if (payload.type === "SOL_TRANSFER") {
      payload.native_transfers?.forEach((transfer) => {
        if (transfer.from_address && transfer.amount !== undefined) {
          logger.debug("Shyft callback: SOL transfer detected", {
            from: transfer.from_address,
            to: transfer.to_address,
            amount: transfer.amount,
          });
        }
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
