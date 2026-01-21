import { Prisma, PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Create connection pool
// Vercel uses prefixed env vars: DEV_STORAGE_* for dev/preview, PROD_STORAGE_* for production
const connectionString =
  process.env.DEV_STORAGE_POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.PROD_STORAGE_POSTGRES_URL;

const pool = new Pool({
  connectionString,
});

// Create adapter
const adapter = new PrismaPg(pool);

// Create Prisma Client with adapter
const prismaLogLevels: Prisma.LogLevel[] = ["error", "warn", "query"];

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: prismaLogLevels,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
