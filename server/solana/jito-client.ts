import { searcher } from "jito-ts";
import { PublicKey } from "@solana/web3.js";
import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import {
  getDefaultJitoBlockEngineUrl,
  jitoConfig,
} from "@/lib/config/jito.config";

function toGrpcEndpoint(url: string) {
  const parsed = new URL(url);
  return parsed.host;
}

const TIP_CACHE_TTL_MS = 60_000;

// Well-known Jito tip accounts. The list is effectively static per Jito docs
// and is used as a fallback when every regional engine fails the
// getTipAccounts gRPC call (rate limit, transient outage, network issue).
// Without this fallback a single Jito hiccup kills launches and exits.
const STATIC_TIP_ACCOUNTS: readonly string[] = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pivKeVBBjNS1d8DJEX1B",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

function pickStaticTipAccount(): PublicKey {
  const address =
    STATIC_TIP_ACCOUNTS[Math.floor(Math.random() * STATIC_TIP_ACCOUNTS.length)];
  return new PublicKey(address);
}

type JitoSendResult =
  | { ok: true; value: string }
  | { ok: false; error: string | { message?: string } };

export type JitoInflightBundleStatus = {
  bundleId: string;
  status: string;
  landedSlot: number | null;
};

export type JitoInflightBundleStatuses = {
  contextSlot: number | null;
  bundles: JitoInflightBundleStatus[];
};

type JitoInflightBundleStatusesResult =
  | {
      ok: true;
      value: JitoInflightBundleStatuses;
      endpoint: string;
      // True when the responding endpoint is the requested preferEndpoint.
      // An "Invalid" status from another region is inconclusive — only the
      // block engine that accepted the bundle tracks it while in-flight.
      matchedPreferred: boolean;
    }
  | { ok: false; error: string };

export type JitoBundleStatus = {
  bundleId: string;
  transactions: string[];
  slot: number | null;
  confirmationStatus: string | null;
  err: unknown;
};

export type JitoBundleStatuses = {
  contextSlot: number | null;
  bundles: JitoBundleStatus[];
};

type JitoBundleStatusesResult =
  | {
      ok: true;
      value: JitoBundleStatuses;
      endpoint: string;
    }
  | { ok: false; error: string };

type TipCacheEntry = {
  fetchedAt: number;
  accounts: PublicKey[];
};

const tipCache = new Map<string, TipCacheEntry>();

// Jito returns "Retry after Xms" (per-endpoint rate limit) and
// "Network congested. Endpoint is globally rate limited." (global throttle).
// We track per-endpoint cooldown timestamps and skip endpoints that are in
// cooldown until the time elapses. If all endpoints are in cooldown we still
// try them (sorted by soonest-to-recover) so the loop is never fully blocked.
const RATE_LIMIT_DEFAULT_COOLDOWN_MS = 5_000;
const RATE_LIMIT_MAX_COOLDOWN_MS = 120_000;
const endpointCooldowns = new Map<string, number>();

function parseRetryAfterMs(message: string): number | null {
  const match = message.match(/Retry after (\d+)\s*ms/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, RATE_LIMIT_MAX_COOLDOWN_MS);
}

type JitoClientLogOptions = {
  launchId?: string;
};

function jitoClientLogContext(options?: JitoClientLogOptions) {
  return {
    subsystem: "jito-client" as const,
    ...(options?.launchId ? { launchId: options.launchId } : {}),
  };
}

function looksRateLimited(message: string): boolean {
  return /rate[ -]?limit|globally rate limited|network congested|too many requests/i.test(
    message
  );
}

function maybeRecordCooldown(endpoint: string, message: string) {
  if (!looksRateLimited(message)) return;
  const retryAfter = parseRetryAfterMs(message);
  const cooldownMs = retryAfter ?? RATE_LIMIT_DEFAULT_COOLDOWN_MS;
  const until = Date.now() + cooldownMs;
  const existing = endpointCooldowns.get(endpoint) ?? 0;
  if (until > existing) {
    endpointCooldowns.set(endpoint, until);
    logger.warn("Jito endpoint cooldown applied", {
      endpoint,
      cooldownMs,
      reason: message.slice(0, 200),
    });
  }
}

function isEndpointInCooldown(endpoint: string): boolean {
  const until = endpointCooldowns.get(endpoint);
  if (until == null) return false;
  if (until <= Date.now()) {
    endpointCooldowns.delete(endpoint);
    return false;
  }
  return true;
}

function filterAvailable<T extends { endpoint: string }>(entries: T[]): T[] {
  const available = entries.filter((e) => !isEndpointInCooldown(e.endpoint));
  if (available.length > 0) return available;
  return [...entries].sort((a, b) => {
    const aUntil = endpointCooldowns.get(a.endpoint) ?? 0;
    const bUntil = endpointCooldowns.get(b.endpoint) ?? 0;
    return aUntil - bUntil;
  });
}

function resolveGrpcEndpoints(rpcUrl: string) {
  const urls = jitoConfig.blockEngineUrls;
  const normalized = rpcUrl.toLowerCase();
  const isTestnet =
    normalized.includes("testnet") || normalized.includes("devnet");
  const filtered = urls.filter((url) => url.includes("testnet") === isTestnet);
  const selected = filtered.length > 0 ? filtered : urls;
  const endpoints = Array.from(new Set(selected.map(toGrpcEndpoint)));
  return endpoints.length > 0
    ? endpoints
    : [toGrpcEndpoint(getDefaultJitoBlockEngineUrl())];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeError(value: unknown) {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  return String(value ?? "");
}

type JitoState = {
  endpoints: string[];
  clients: {
    endpoint: string;
    url: string;
    client: ReturnType<typeof searcher.searcherClient>;
  }[];
  preferredEndpoint: string;
};

let jitoState: JitoState | null = null;

function getJitoState(): JitoState {
  if (jitoState) {
    return jitoState;
  }
  const { SOLANA_RPC_URL } = getEnv();
  const endpoints = resolveGrpcEndpoints(SOLANA_RPC_URL);
  const clients = endpoints.map((endpoint) => {
    const url =
      jitoConfig.blockEngineUrls.find((candidate) => toGrpcEndpoint(candidate) === endpoint) ??
      `https://${endpoint}`;
    return {
      endpoint,
      url,
      client: searcher.searcherClient(endpoint),
    };
  });
  jitoState = {
    endpoints,
    clients,
    preferredEndpoint:
      endpoints[0] ?? toGrpcEndpoint(getDefaultJitoBlockEngineUrl()),
  };
  return jitoState;
}

function orderedClients() {
  const state = getJitoState();
  const clients = state.clients;
  if (clients.length <= 1) {
    return filterAvailable(clients);
  }
  const startIndex = clients.findIndex(
    (entry) => entry.endpoint === state.preferredEndpoint
  );
  if (startIndex <= 0) {
    return filterAvailable(clients);
  }
  return filterAvailable([
    ...clients.slice(startIndex),
    ...clients.slice(0, startIndex),
  ]);
}

function orderedClientsPinnedTo(endpoint: string | null) {
  if (!endpoint) {
    return orderedClients();
  }
  const state = getJitoState();
  const clients = state.clients;
  const pinnedIndex = clients.findIndex((entry) => entry.endpoint === endpoint);
  if (pinnedIndex < 0) {
    return orderedClients();
  }
  if (clients.length <= 1) {
    return filterAvailable(clients);
  }
  return filterAvailable([
    clients[pinnedIndex],
    ...clients.slice(0, pinnedIndex),
    ...clients.slice(pinnedIndex + 1),
  ]);
}

function setPreferredEndpoint(endpoint: string) {
  const state = getJitoState();
  state.preferredEndpoint = endpoint;
}

// Move the preferred endpoint to the next region so the following sendBundle
// starts elsewhere. Used when a block engine accepted a bundle but dropped it
// (sustained "Invalid" inflight status from the receiving endpoint).
export function rotatePreferredEndpointAwayFrom(endpoint: string) {
  const state = getJitoState();
  const clients = state.clients;
  if (clients.length <= 1) {
    return state.preferredEndpoint;
  }
  const index = clients.findIndex((entry) => entry.endpoint === endpoint);
  const nextIndex = index < 0 ? 0 : (index + 1) % clients.length;
  state.preferredEndpoint = clients[nextIndex].endpoint;
  return state.preferredEndpoint;
}

function getBundleRpcUrl(baseUrl: string) {
  return `${baseUrl}/api/v1/bundles`;
}

function normalizeRpcError(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    const message =
      typeof value.message === "string" ? value.message : normalizeError(value);
    const data =
      "data" in value && value.data !== undefined
        ? ` ${normalizeError(value.data)}`
        : "";
    return `${message}${data}`.trim();
  }
  return normalizeError(value);
}

async function postBundleRpcRequest(
  url: string,
  method: string,
  params: unknown[]
) {
  const response = await fetch(getBundleRpcUrl(url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  const responseText = await response.text();
  let payload: unknown = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = responseText;
  }

  if (!response.ok) {
    throw new Error(
      isRecord(payload) && "error" in payload
        ? normalizeRpcError(payload.error)
        : `HTTP ${response.status} ${response.statusText}`
    );
  }

  if (isRecord(payload) && "error" in payload) {
    throw new Error(normalizeRpcError(payload.error));
  }

  return payload;
}

export function parseInflightBundleStatusesResponse(
  payload: unknown
): JitoInflightBundleStatuses {
  if (!isRecord(payload) || !isRecord(payload.result)) {
    throw new Error("Invalid inflight bundle status response");
  }

  const contextSlot =
    isRecord(payload.result.context) && typeof payload.result.context.slot === "number"
      ? payload.result.context.slot
      : null;
  const rawBundles = Array.isArray(payload.result.value) ? payload.result.value : [];

  return {
    contextSlot,
    bundles: rawBundles.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.bundle_id !== "string") {
        return [];
      }
      return [
        {
          bundleId: entry.bundle_id,
          status: typeof entry.status === "string" ? entry.status : "Unknown",
          landedSlot:
            typeof entry.landed_slot === "number" ? entry.landed_slot : null,
        },
      ];
    }),
  };
}

export async function getTipAccount(options?: JitoClientLogOptions) {
  const logContext = jitoClientLogContext(options);
  const now = Date.now();
  for (const entry of orderedClients()) {
    const cached = tipCache.get(entry.endpoint);
    if (cached && now - cached.fetchedAt < TIP_CACHE_TTL_MS) {
      setPreferredEndpoint(entry.endpoint);
      const pick =
        cached.accounts[Math.floor(Math.random() * cached.accounts.length)];
      return pick ?? cached.accounts[0];
    }
  }

  for (const entry of orderedClients()) {
    try {
      const response = (await entry.client.getTipAccounts()) as
        | { ok: true; value: string[] }
        | { ok: false; error: string }
        | string[];
      let accounts: PublicKey[] = [];
      if (Array.isArray(response)) {
        accounts = response.map((addr) => new PublicKey(addr));
      } else if (response.ok) {
        accounts = response.value.map((addr) => new PublicKey(addr));
      } else {
        const errorMessage = response.error || "Failed to fetch tip accounts";
        maybeRecordCooldown(entry.endpoint, errorMessage);
        logger.warn("Jito tip account fetch failed", {
          ...logContext,
          endpoint: entry.endpoint,
          error: errorMessage,
        });
        continue;
      }
      if (accounts.length === 0) {
        logger.warn("Jito tip account list empty", {
          ...logContext,
          endpoint: entry.endpoint,
        });
        continue;
      }
      tipCache.set(entry.endpoint, { fetchedAt: now, accounts });
      setPreferredEndpoint(entry.endpoint);
      return accounts[Math.floor(Math.random() * accounts.length)];
    } catch (error) {
      const message = normalizeError(error);
      maybeRecordCooldown(entry.endpoint, message);
      logger.warn("Jito tip account request error", {
        ...logContext,
        endpoint: entry.endpoint,
        error: message,
      });
    }
  }

  logger.warn("Jito tip account fetch failed on all endpoints, using static fallback", logContext);
  return pickStaticTipAccount();
}

export type JitoSendRejection = { endpoint: string; error: string };

export async function sendBundle(
  bundleToSend: import("jito-ts").bundle.Bundle,
  options?: JitoClientLogOptions
) {
  const logContext = jitoClientLogContext(options);
  let lastError: JitoSendResult | null = null;
  const rejections: JitoSendRejection[] = [];
  for (const entry of orderedClients()) {
    try {
      const response = (await entry.client.sendBundle(
        bundleToSend
      )) as JitoSendResult;
      if (response.ok) {
        setPreferredEndpoint(entry.endpoint);
        return { ...response, endpoint: entry.endpoint, rejections };
      }
      const message = normalizeError(response.error);
      maybeRecordCooldown(entry.endpoint, message);
      rejections.push({ endpoint: entry.endpoint, error: message });
      lastError = {
        ok: false,
        error: message ? `endpoint=${entry.endpoint} ${message}` : message,
      };
      logger.warn("Jito bundle rejected", {
        ...logContext,
        endpoint: entry.endpoint,
        error: message,
      });
    } catch (error) {
      const message = normalizeError(error);
      maybeRecordCooldown(entry.endpoint, message);
      rejections.push({ endpoint: entry.endpoint, error: message });
      lastError = {
        ok: false,
        error: message ? `endpoint=${entry.endpoint} ${message}` : message,
      };
      logger.warn("Jito bundle send error", {
        ...logContext,
        endpoint: entry.endpoint,
        error: message,
      });
    }
  }
  return lastError
    ? { ...lastError, rejections }
    : { ok: false as const, error: "Jito bundle send failed", rejections };
}

export async function getInflightBundleStatuses(
  bundleIds: string[],
  options?: { preferEndpoint?: string | null; launchId?: string }
): Promise<JitoInflightBundleStatusesResult> {
  const logContext = jitoClientLogContext(options);
  if (bundleIds.length === 0) {
    return { ok: false, error: "No bundle IDs provided" };
  }
  if (bundleIds.length > 5) {
    return {
      ok: false,
      error: `Too many bundle IDs provided: ${bundleIds.length} > 5`,
    };
  }

  const preferEndpoint = options?.preferEndpoint ?? null;
  const candidates = orderedClientsPinnedTo(preferEndpoint);

  let lastError: string | null = null;
  for (const entry of candidates) {
    try {
      const payload = await postBundleRpcRequest(entry.url, "getInflightBundleStatuses", [
        bundleIds,
      ]);
      const parsed = parseInflightBundleStatusesResponse(payload);
      return {
        ok: true,
        value: parsed,
        endpoint: entry.endpoint,
        matchedPreferred:
          preferEndpoint === null || entry.endpoint === preferEndpoint,
      };
    } catch (error) {
      const message = normalizeError(error);
      maybeRecordCooldown(entry.endpoint, message);
      lastError = message ? `endpoint=${entry.endpoint} ${message}` : message;
      logger.warn("Jito inflight bundle status error", {
        ...logContext,
        endpoint: entry.endpoint,
        error: message,
      });
    }
  }

  return lastError
    ? { ok: false, error: lastError }
    : { ok: false, error: "Jito inflight bundle status request failed" };
}

export function parseBundleStatusesResponse(
  payload: unknown
): JitoBundleStatuses {
  if (!isRecord(payload) || !isRecord(payload.result)) {
    throw new Error("Invalid bundle status response");
  }

  const contextSlot =
    isRecord(payload.result.context) &&
    typeof payload.result.context.slot === "number"
      ? payload.result.context.slot
      : null;
  const rawBundles = Array.isArray(payload.result.value)
    ? payload.result.value
    : [];

  return {
    contextSlot,
    bundles: rawBundles.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.bundle_id !== "string") {
        return [];
      }
      const transactions = Array.isArray(entry.transactions)
        ? entry.transactions.filter(
            (sig): sig is string => typeof sig === "string"
          )
        : [];
      return [
        {
          bundleId: entry.bundle_id,
          transactions,
          slot: typeof entry.slot === "number" ? entry.slot : null,
          confirmationStatus:
            typeof entry.confirmation_status === "string"
              ? entry.confirmation_status
              : null,
          err: entry.err ?? null,
        },
      ];
    }),
  };
}

// Cross-region "did this bundle land and at what confirmation level".
// Differs from getInflightBundleStatuses (per-region Pending/Landed/Failed/
// Invalid). getBundleStatuses returns processed/confirmed/finalized only for
// bundles already on-chain; returns no record for not-yet-landed bundles.
// Use as a stronger landing signal that doesn't depend on the regional engine
// that originally accepted the bundle.
export async function getBundleStatuses(
  bundleIds: string[],
  options?: { preferEndpoint?: string | null; launchId?: string }
): Promise<JitoBundleStatusesResult> {
  const logContext = jitoClientLogContext(options);
  if (bundleIds.length === 0) {
    return { ok: false, error: "No bundle IDs provided" };
  }
  if (bundleIds.length > 5) {
    return {
      ok: false,
      error: `Too many bundle IDs provided: ${bundleIds.length} > 5`,
    };
  }

  const preferEndpoint = options?.preferEndpoint ?? null;
  const candidates = orderedClientsPinnedTo(preferEndpoint);

  let lastError: string | null = null;
  for (const entry of candidates) {
    try {
      const payload = await postBundleRpcRequest(
        entry.url,
        "getBundleStatuses",
        [bundleIds]
      );
      const parsed = parseBundleStatusesResponse(payload);
      return {
        ok: true,
        value: parsed,
        endpoint: entry.endpoint,
      };
    } catch (error) {
      const message = normalizeError(error);
      maybeRecordCooldown(entry.endpoint, message);
      lastError = message ? `endpoint=${entry.endpoint} ${message}` : message;
      logger.warn("Jito bundle status error", {
        ...logContext,
        endpoint: entry.endpoint,
        error: message,
      });
    }
  }

  return lastError
    ? { ok: false, error: lastError }
    : { ok: false, error: "Jito bundle status request failed" };
}
