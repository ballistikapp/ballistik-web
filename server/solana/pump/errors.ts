import "server-only";
import { AppError } from "@/server/errors";
import { invalidateGlobalCache } from "@/server/solana/pump/global-account";

const PUMP_ERROR_MESSAGES: Record<number, string> = {
  6057: "Pump.fun buyback fee recipient is not authorized. Please retry.",
  6058: "Pump.fun buyback configuration invalid (zero recipient).",
  6059: "Pump.fun buyback configuration invalid (duplicate recipients).",
  6060: "Pump.fun buyback basis points out of range.",
  6061:
    "Pump.fun program upgraded; transaction is missing buyback fee recipients. Please retry.",
  6062:
    "Pump.fun program upgraded; transaction is missing buyback fee recipients. Please retry.",
};

const ERROR_CODE_REGEX = /custom program error:\s*0x([0-9a-fA-F]+)/;
const ANCHOR_ERROR_REGEX = /Error Number:\s*(\d+)/;

function extractPumpErrorCode(message: string): number | null {
  const anchorMatch = message.match(ANCHOR_ERROR_REGEX);
  if (anchorMatch) {
    const code = Number.parseInt(anchorMatch[1], 10);
    if (Number.isFinite(code)) return code;
  }
  const customMatch = message.match(ERROR_CODE_REGEX);
  if (customMatch) {
    return Number.parseInt(customMatch[1], 16);
  }
  return null;
}

export function mapPumpError(error: unknown): AppError | null {
  const message =
    error instanceof Error
      ? `${error.message}\n${(error as { logs?: string[] }).logs?.join("\n") ?? ""}`
      : String(error);

  const code = extractPumpErrorCode(message);
  if (code == null) return null;

  const friendly = PUMP_ERROR_MESSAGES[code];
  if (!friendly) return null;

  if (code === 6061 || code === 6062) {
    invalidateGlobalCache();
  }

  return new AppError(friendly, 400, { pumpErrorCode: code });
}
