import { AppError } from "@/server/errors";

export type RateLimitTier =
  | "public"
  | "auth"
  | "protected"
  | "expensiveMutation"
  | "sensitiveMutation"
  | "webhook";

type TierConfig = {
  windowMs: number;
  limit: number;
};

type RateLimitWindow = {
  count: number;
  resetAt: number;
};

type IdempotencyEntry = {
  expiresAt: number;
  value: unknown;
};

const tierConfig: Record<RateLimitTier, TierConfig> = {
  public: { windowMs: 60_000, limit: 120 },
  auth: { windowMs: 60_000, limit: 12 },
  protected: { windowMs: 60_000, limit: 180 },
  expensiveMutation: { windowMs: 60_000, limit: 24 },
  sensitiveMutation: { windowMs: 60_000, limit: 8 },
  webhook: { windowMs: 60_000, limit: 180 },
};

const rateLimitState = new Map<string, RateLimitWindow>();
const replayState = new Map<string, number>();
const idempotencyState = new Map<string, IdempotencyEntry>();
const actionLocks = new Set<string>();

function nowMs() {
  return Date.now();
}

function pruneRateLimitState(now: number) {
  for (const [key, value] of rateLimitState.entries()) {
    if (value.resetAt <= now) {
      rateLimitState.delete(key);
    }
  }
}

function pruneReplayState(now: number) {
  for (const [key, value] of replayState.entries()) {
    if (value <= now) {
      replayState.delete(key);
    }
  }
}

function pruneIdempotencyState(now: number) {
  for (const [key, value] of idempotencyState.entries()) {
    const expiresAt = value.expiresAt;
    if (expiresAt <= now) {
      idempotencyState.delete(key);
    }
  }
}

export function getRateLimitTierConfig(tier: RateLimitTier): TierConfig {
  return tierConfig[tier];
}

export function consumeRateLimit(input: {
  tier: RateLimitTier;
  key: string;
  cost?: number;
}) {
  const now = nowMs();
  pruneRateLimitState(now);

  const config = getRateLimitTierConfig(input.tier);
  const cost = Math.max(1, input.cost ?? 1);
  const scopedKey = `${input.tier}:${input.key}`;
  const current = rateLimitState.get(scopedKey);

  if (!current || current.resetAt <= now) {
    const next: RateLimitWindow = {
      count: cost,
      resetAt: now + config.windowMs,
    };
    rateLimitState.set(scopedKey, next);
    return {
      allowed: true,
      remaining: Math.max(0, config.limit - next.count),
      resetAt: next.resetAt,
      limit: config.limit,
    };
  }

  const nextCount = current.count + cost;
  if (nextCount > config.limit) {
    return {
      allowed: false,
      remaining: Math.max(0, config.limit - current.count),
      resetAt: current.resetAt,
      limit: config.limit,
    };
  }

  current.count = nextCount;
  rateLimitState.set(scopedKey, current);
  return {
    allowed: true,
    remaining: Math.max(0, config.limit - current.count),
    resetAt: current.resetAt,
    limit: config.limit,
  };
}

export function ensureRateLimit(input: {
  tier: RateLimitTier;
  key: string;
  cost?: number;
}) {
  const result = consumeRateLimit(input);
  if (!result.allowed) {
    throw new AppError("Too many requests. Please retry shortly.", 429, {
      tier: input.tier,
      key: input.key,
      limit: result.limit,
      resetAt: result.resetAt,
    });
  }
  return result;
}

export async function withActionLock<T>(
  key: string,
  execute: () => Promise<T>
): Promise<T> {
  if (actionLocks.has(key)) {
    throw new AppError("A similar request is already in progress", 409, { key });
  }
  actionLocks.add(key);
  try {
    return await execute();
  } finally {
    actionLocks.delete(key);
  }
}

export async function withIdempotency<T>(input: {
  key: string;
  ttlMs: number;
  execute: () => Promise<T>;
}): Promise<T> {
  const now = nowMs();
  pruneIdempotencyState(now);

  const cached = idempotencyState.get(input.key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const value = await input.execute();
  idempotencyState.set(input.key, {
    value,
    expiresAt: now + Math.max(1_000, input.ttlMs),
  });
  return value;
}

export function checkReplayWindow(input: {
  scope: string;
  value: string;
  windowMs: number;
}) {
  const now = nowMs();
  pruneReplayState(now);

  const scopedKey = `${input.scope}:${input.value}`;
  const expiresAt = replayState.get(scopedKey);
  if (expiresAt && expiresAt > now) {
    return false;
  }

  replayState.set(scopedKey, now + Math.max(1_000, input.windowMs));
  return true;
}
