import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { getEnv } from "@/lib/config/env";

const INSECURE_FALLBACK_SECRET = "your-secret-key-change-in-production";

const DEFAULT_JWT_EXPIRATION: SignOptions["expiresIn"] = "12h";

function resolveJwtExpiration(): SignOptions["expiresIn"] {
  const env = getEnv();
  return (env.JWT_EXPIRATION as SignOptions["expiresIn"] | undefined) || DEFAULT_JWT_EXPIRATION;
}

export function getAccessTokenMaxAgeSeconds() {
  const expiration = resolveJwtExpiration();
  if (typeof expiration === "number") {
    return expiration;
  }

  const normalized = String(expiration ?? DEFAULT_JWT_EXPIRATION).trim();
  const directNumber = Number(normalized);
  if (!Number.isNaN(directNumber) && directNumber > 0) {
    return directNumber;
  }

  const match = /^(\d+)([smhd])$/i.exec(normalized);
  if (!match) {
    return 12 * 60 * 60;
  }
  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === "s") return value;
  if (unit === "m") return value * 60;
  if (unit === "h") return value * 60 * 60;
  if (unit === "d") return value * 60 * 60 * 24;
  return 12 * 60 * 60;
}

function resolveJwtSecret() {
  const env = getEnv();
  const jwtSecret = env.JWT_SECRET;
  if (
    process.env.NODE_ENV === "production" &&
    (!jwtSecret || jwtSecret === INSECURE_FALLBACK_SECRET)
  ) {
    throw new Error("JWT_SECRET must be set to a strong value in production.");
  }
  return jwtSecret || INSECURE_FALLBACK_SECRET;
}

export interface JWTPayload {
  userId: string;
  publicKey: string;
  name?: string;
  iat?: number;
  exp?: number;
}

export function signToken(
  userId: string,
  publicKey: string,
  name: string
): string {
  return jwt.sign({ userId, publicKey, name }, resolveJwtSecret(), {
    expiresIn: resolveJwtExpiration(),
  });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, resolveJwtSecret()) as JWTPayload;
    return decoded;
  } catch {
    return null;
  }
}
