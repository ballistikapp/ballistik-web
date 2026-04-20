import { status as GrpcStatus } from "@grpc/grpc-js";
import { isRecord } from "./grpc-utils";

const STATUS_NAMES: Record<number, string> = {
  [GrpcStatus.OK]: "OK",
  [GrpcStatus.CANCELLED]: "CANCELLED",
  [GrpcStatus.UNKNOWN]: "UNKNOWN",
  [GrpcStatus.INVALID_ARGUMENT]: "INVALID_ARGUMENT",
  [GrpcStatus.DEADLINE_EXCEEDED]: "DEADLINE_EXCEEDED",
  [GrpcStatus.NOT_FOUND]: "NOT_FOUND",
  [GrpcStatus.ALREADY_EXISTS]: "ALREADY_EXISTS",
  [GrpcStatus.PERMISSION_DENIED]: "PERMISSION_DENIED",
  [GrpcStatus.RESOURCE_EXHAUSTED]: "RESOURCE_EXHAUSTED",
  [GrpcStatus.FAILED_PRECONDITION]: "FAILED_PRECONDITION",
  [GrpcStatus.ABORTED]: "ABORTED",
  [GrpcStatus.OUT_OF_RANGE]: "OUT_OF_RANGE",
  [GrpcStatus.UNIMPLEMENTED]: "UNIMPLEMENTED",
  [GrpcStatus.INTERNAL]: "INTERNAL",
  [GrpcStatus.UNAVAILABLE]: "UNAVAILABLE",
  [GrpcStatus.DATA_LOSS]: "DATA_LOSS",
  [GrpcStatus.UNAUTHENTICATED]: "UNAUTHENTICATED",
};

export type GrpcTokenEnvSummary = {
  configured: boolean;
  length: number;
  /** True when SHYFT_GRPC_TOKEN equals SHYFT_API_KEY (often wrong for gRPC). */
  sameAsShyftApiKey: boolean;
  /** Rough shape hint only; never the secret value. */
  shape: "empty" | "jwt_like" | "opaque";
};

export type GrpcErrorDiagnostics = {
  grpcCode: number | null;
  grpcCodeName: string | null;
  /** gRPC details string from the server (if any). */
  details: string | null;
  /** Non-binary metadata entries only; binary keys summarized as byte length. */
  metadata: Record<string, string> | null;
  /** Best-effort classification; Shyft often merges token + IP in one message. */
  shyftAuthHint:
    | "unauthenticated_generic"
    | "likely_token_or_ip_combined"
    | "permission_denied"
    | "unavailable"
    | null;
  /** Actionable checks that match this codebase + Shyft’s typical failures. */
  hints: string[];
  /** error.message when Error-shaped; may duplicate details. */
  message: string | null;
};

function hasGetMap(
  value: unknown
): value is { getMap: () => Record<string, string | Buffer> } {
  return isRecord(value) && typeof value.getMap === "function";
}

function summarizeMetadata(metadata: unknown): Record<string, string> | null {
  if (!hasGetMap(metadata)) return null;
  try {
    const map = metadata.getMap();
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(map)) {
      if (key.endsWith("-bin")) {
        out[key] =
          typeof Buffer !== "undefined" && Buffer.isBuffer(value)
            ? `<${value.length} bytes>`
            : "<binary>";
      } else {
        out[key] = String(value);
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function isServiceErrorShape(
  error: unknown
): error is { code: number; details?: string; metadata?: unknown } {
  return isRecord(error) && typeof error.code === "number";
}

/**
 * Pull structured fields from @grpc/grpc-js ServiceError (and compatible objects).
 */
export function diagnoseGrpcError(
  error: unknown,
  context: { tokenEnv: GrpcTokenEnvSummary }
): GrpcErrorDiagnostics {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : null;

  if (!isServiceErrorShape(error)) {
    return {
      grpcCode: null,
      grpcCodeName: null,
      details: null,
      metadata: null,
      shyftAuthHint: null,
      hints: buildEnvHints(context.tokenEnv, null, message),
      message,
    };
  }

  const code = error.code;
  const codeName = STATUS_NAMES[code] ?? `CODE_${code}`;
  const metadata = summarizeMetadata(error.metadata);
  const details = typeof error.details === "string" ? error.details : null;

  const combined =
    `${details ?? ""} ${message ?? ""}`.toLowerCase();

  let shyftAuthHint: GrpcErrorDiagnostics["shyftAuthHint"] = null;
  if (code === GrpcStatus.UNAUTHENTICATED) {
    shyftAuthHint =
      combined.includes("invalid token") && combined.includes("ip")
        ? "likely_token_or_ip_combined"
        : "unauthenticated_generic";
  } else if (code === GrpcStatus.PERMISSION_DENIED) {
    shyftAuthHint = "permission_denied";
  } else if (code === GrpcStatus.UNAVAILABLE) {
    shyftAuthHint = "unavailable";
  }

  const hints = [
    ...buildEnvHints(context.tokenEnv, code, details ?? message),
    ...buildCodeHints(code, details, message),
  ];

  return {
    grpcCode: code,
    grpcCodeName: codeName,
    details,
    metadata,
    shyftAuthHint,
    hints,
    message,
  };
}

function buildCodeHints(
  code: number,
  details: string | null,
  message: string | null
): string[] {
  const hints: string[] = [];
  const text = `${details ?? ""} ${message ?? ""}`;

  if (code === GrpcStatus.UNAUTHENTICATED) {
    hints.push(
      "gRPC status UNAUTHENTICATED (16): transport reached Shyft but credentials were rejected."
    );
    if (/invalid token|invalid api|unauthorized/i.test(text)) {
      hints.push(
        "Server text mentions invalid token/API: verify SHYFT_GRPC_TOKEN is the dedicated gRPC token from Shyft (not necessarily the same string as SHYFT_API_KEY)."
      );
    }
    if (/ip|address|allowlist|whitelist/i.test(text)) {
      hints.push(
        "Server text mentions IP/allowlist: confirm Shyft gRPC IP restrictions include this host’s outbound IP (local dev often differs from production)."
      );
    }
  }

  if (code === GrpcStatus.PERMISSION_DENIED) {
    hints.push(
      "PERMISSION_DENIED (7): subscription or plan may not include RabbitStream/gRPC for this token."
    );
  }

  if (code === GrpcStatus.UNAVAILABLE) {
    hints.push(
      "UNAVAILABLE (14): endpoint or network path issue; less often a pure auth problem."
    );
  }

  return hints;
}

function buildEnvHints(
  tokenEnv: GrpcTokenEnvSummary,
  code: number | null,
  detailsOrMessage: string | null
): string[] {
  const hints: string[] = [];
  const text = (detailsOrMessage ?? "").toLowerCase();

  if (!tokenEnv.configured) {
    hints.push("SHYFT_GRPC_TOKEN is not set; connect() should not have run — investigate call sites.");
  } else {
    if (tokenEnv.sameAsShyftApiKey) {
      hints.push(
        "SHYFT_GRPC_TOKEN is identical to SHYFT_API_KEY. gRPC usually needs the separate gRPC/x-token from Shyft."
      );
    }
    if (tokenEnv.shape === "jwt_like") {
      hints.push(
        "SHYFT_GRPC_TOKEN looks JWT-shaped (starts with eyJ). Shyft gRPC tokens are often opaque strings; confirm you did not paste a session/JWT by mistake."
      );
    }
    if (tokenEnv.length > 0 && tokenEnv.length < 20) {
      hints.push(
        "SHYFT_GRPC_TOKEN is very short; double-check the full value from the Shyft dashboard."
      );
    }
  }

  if (
    code === GrpcStatus.UNAUTHENTICATED &&
    text.includes("invalid token") &&
    text.includes("ip")
  ) {
    hints.push(
      "Shyft returns one message for both cases: validate the gRPC token and IP allowlist independently in the Shyft dashboard; logs cannot split which check failed."
    );
  }

  return hints;
}

export function summarizeGrpcTokenEnv(input: {
  shyftGrpcToken: string | undefined;
  shyftApiKey: string;
}): GrpcTokenEnvSummary {
  const raw = input.shyftGrpcToken?.trim() ?? "";
  const configured = raw.length > 0;
  const sameAsShyftApiKey = configured && raw === input.shyftApiKey;
  let shape: GrpcTokenEnvSummary["shape"] = "opaque";
  if (!configured) shape = "empty";
  else if (raw.startsWith("eyJ")) shape = "jwt_like";

  return {
    configured,
    length: raw.length,
    sameAsShyftApiKey,
    shape,
  };
}
