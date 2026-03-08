import { createHash, randomBytes } from "crypto";
import { getEnv } from "@/lib/config/env";

const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;
const DEFAULT_SESSION_MAX_TTL_DAYS = 90;

export function createOpaqueRefreshToken() {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function getRefreshTokenTtlDays() {
  const env = getEnv();
  return env.REFRESH_TOKEN_TTL_DAYS ?? DEFAULT_REFRESH_TOKEN_TTL_DAYS;
}

export function getSessionMaxTtlDays() {
  const env = getEnv();
  return env.SESSION_MAX_TTL_DAYS ?? DEFAULT_SESSION_MAX_TTL_DAYS;
}

export function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
