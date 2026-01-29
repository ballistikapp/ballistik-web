#!/usr/bin/env tsx

import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

dotenv.config({
  path: join(process.cwd(), ".env.development.local"),
  quiet: true,
});

const connectionString =
  process.env.PROD_STORAGE_POSTGRES_URL || process.env.DEV_STORAGE_POSTGRES_URL;

if (!connectionString) {
  console.error(
    "❌ Error: Database connection string not found. Please set PROD_STORAGE_POSTGRES_URL or DEV_STORAGE_POSTGRES_URL in .env.development.local"
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ["error"],
});

interface VanityMintJson {
  id: number;
  private_key: string;
  public_key: string;
  suffix: string;
  project_id: number | null;
  created_at: string;
  used_at: string | null;
}

async function importVanityMints() {
  try {
    const filePath = join(process.cwd(), "data", "vanity-mints.json");
    console.log(`📂 Reading vanity mints from: ${filePath}\n`);

    const fileContent = readFileSync(filePath, "utf-8");
    const vanityMints: VanityMintJson[] = JSON.parse(fileContent);

    console.log(`📊 Found ${vanityMints.length} vanity mint(s) in file\n`);

    // Check existing vanity mints to avoid duplicates
    const existingMints = await prisma.vanityMint.findMany({
      select: { publicKey: true },
    });
    const existingPublicKeys = new Set(existingMints.map((m) => m.publicKey));

    console.log(
      `📊 Found ${existingMints.length} existing vanity mint(s) in database\n`
    );

    const mintsToInsert = vanityMints.filter(
      (mint) => !existingPublicKeys.has(mint.public_key)
    );

    if (mintsToInsert.length === 0) {
      console.log(
        "✅ All vanity mints already exist in database. Nothing to insert."
      );
      return;
    }

    console.log(`📥 Inserting ${mintsToInsert.length} new vanity mint(s)...\n`);

    // Insert in batches to avoid overwhelming the database
    const BATCH_SIZE = 100;
    let insertedCount = 0;
    const skippedCount = vanityMints.length - mintsToInsert.length;

    for (let i = 0; i < mintsToInsert.length; i += BATCH_SIZE) {
      const batch = mintsToInsert.slice(i, i + BATCH_SIZE);

      const result = await prisma.vanityMint.createMany({
        data: batch.map((mint) => ({
          publicKey: mint.public_key,
          privateKey: mint.private_key,
          usedAt: mint.used_at ? new Date(mint.used_at) : null,
        })),
        skipDuplicates: true,
      });

      insertedCount += result.count;

      const progress = Math.min(i + BATCH_SIZE, mintsToInsert.length);
      console.log(
        `   ✅ Processed ${progress}/${mintsToInsert.length} (inserted ${result.count} in this batch)`
      );
    }

    console.log("\n" + "=".repeat(50));
    console.log("📈 Summary:");
    console.log(`   ✅ Vanity mints inserted: ${insertedCount}`);
    console.log(`   ⏭️  Vanity mints skipped (already exist): ${skippedCount}`);
    console.log("=".repeat(50) + "\n");
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

importVanityMints();
