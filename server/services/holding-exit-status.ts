import "server-only";
import type { HoldingExitStatus } from "@/lib/generated/prisma/client";

type DeriveHoldingExitTerminalStatusParams = {
  failedChunks: number;
  cleanupFailedWallets: number;
};

export function deriveHoldingExitTerminalStatus({
  failedChunks,
  cleanupFailedWallets,
}: DeriveHoldingExitTerminalStatusParams): {
  status: HoldingExitStatus;
  errorMessage: string | null;
} {
  if (failedChunks > 0) {
    return {
      status: "FAILED",
      errorMessage: `${failedChunks} chunk(s) failed during bundle submission`,
    };
  }

  if (cleanupFailedWallets > 0) {
    return {
      status: "PARTIAL_SUCCESS",
      errorMessage: `${cleanupFailedWallets} wallet(s) had cleanup or SOL recovery failures after successful exit`,
    };
  }

  return {
    status: "SUCCEEDED",
    errorMessage: null,
  };
}
