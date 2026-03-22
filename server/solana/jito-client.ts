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
    }
  | { ok: false; error: string };

type TipCacheEntry = {
  fetchedAt: number;
  accounts: PublicKey[];
};

const tipCache = new Map<string, TipCacheEntry>();

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
    return clients;
  }
  const startIndex = clients.findIndex(
    (entry) => entry.endpoint === state.preferredEndpoint
  );
  if (startIndex <= 0) {
    return clients;
  }
  return [...clients.slice(startIndex), ...clients.slice(0, startIndex)];
}

function setPreferredEndpoint(endpoint: string) {
  const state = getJitoState();
  state.preferredEndpoint = endpoint;
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

export async function getTipAccount() {
  const now = Date.now();
  for (const entry of orderedClients()) {
    const cached = tipCache.get(entry.endpoint);
    if (cached && now - cached.fetchedAt < TIP_CACHE_TTL_MS) {
      setPreferredEndpoint(entry.endpoint);
      return cached.accounts[0];
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
        logger.warn("Jito tip account fetch failed", {
          endpoint: entry.endpoint,
          error: response.error || "Failed to fetch tip accounts",
        });
        continue;
      }
      if (accounts.length === 0) {
        logger.warn("Jito tip account list empty", {
          endpoint: entry.endpoint,
        });
        continue;
      }
      tipCache.set(entry.endpoint, { fetchedAt: now, accounts });
      setPreferredEndpoint(entry.endpoint);
      return accounts[0];
    } catch (error) {
      logger.warn("Jito tip account request error", {
        endpoint: entry.endpoint,
        error: normalizeError(error),
      });
    }
  }

  throw new Error("No tip accounts available");
}

export async function sendBundle(
  bundleToSend: import("jito-ts").bundle.Bundle
) {
  let lastError: JitoSendResult | null = null;
  for (const entry of orderedClients()) {
    try {
      const response = (await entry.client.sendBundle(
        bundleToSend
      )) as JitoSendResult;
      if (response.ok) {
        setPreferredEndpoint(entry.endpoint);
        return { ...response, endpoint: entry.endpoint };
      }
      const message = normalizeError(response.error);
      lastError = {
        ok: false,
        error: message ? `endpoint=${entry.endpoint} ${message}` : message,
      };
      logger.warn("Jito bundle rejected", {
        endpoint: entry.endpoint,
        error: message,
      });
    } catch (error) {
      const message = normalizeError(error);
      lastError = {
        ok: false,
        error: message ? `endpoint=${entry.endpoint} ${message}` : message,
      };
      logger.warn("Jito bundle send error", {
        endpoint: entry.endpoint,
        error: message,
      });
    }
  }
  return lastError ?? { ok: false, error: "Jito bundle send failed" };
}

export async function getInflightBundleStatuses(
  bundleIds: string[]
): Promise<JitoInflightBundleStatusesResult> {
  if (bundleIds.length === 0) {
    return { ok: false, error: "No bundle IDs provided" };
  }
  if (bundleIds.length > 5) {
    return {
      ok: false,
      error: `Too many bundle IDs provided: ${bundleIds.length} > 5`,
    };
  }

  let lastError: string | null = null;
  for (const entry of orderedClients()) {
    try {
      const payload = await postBundleRpcRequest(entry.url, "getInflightBundleStatuses", [
        bundleIds,
      ]);
      const parsed = parseInflightBundleStatusesResponse(payload);
      setPreferredEndpoint(entry.endpoint);
      return {
        ok: true,
        value: parsed,
        endpoint: entry.endpoint,
      };
    } catch (error) {
      const message = normalizeError(error);
      lastError = message ? `endpoint=${entry.endpoint} ${message}` : message;
      logger.warn("Jito inflight bundle status error", {
        endpoint: entry.endpoint,
        error: message,
      });
    }
  }

  return lastError
    ? { ok: false, error: lastError }
    : { ok: false, error: "Jito inflight bundle status request failed" };
}
