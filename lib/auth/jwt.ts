import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";
const JWT_EXPIRATION = "365d";

export interface JWTPayload {
  userId: string;
  publicKey: string;
  iat?: number;
  exp?: number;
}

export function signToken(userId: string, publicKey: string): string {
  return jwt.sign({ userId, publicKey }, JWT_SECRET, {
    expiresIn: JWT_EXPIRATION,
  });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}
