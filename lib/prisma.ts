import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Create connection pool
// Vercel uses prefixed env vars: DEV_STORAGE_* for dev/preview, PROD_STORAGE_* for production
const connectionString =
  process.env.PROD_STORAGE_POSTGRES_URL || process.env.DEV_STORAGE_POSTGRES_URL;

const pool = new Pool({
  connectionString,
});

// Create adapter
const adapter = new PrismaPg(pool);

// Create Prisma Client with adapter
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
