#!/usr/bin/env tsx

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import * as dotenv from "dotenv";
import { join } from "path";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { WalletType } from "../lib/generated/prisma/enums";

dotenv.config({ path: join(process.cwd(), ".env.development.local") });

const connectionString =
  process.env.PROD_STORAGE_POSTGRES_URL || process.env.DEV_STORAGE_POSTGRES_URL;

if (!connectionString) {
  console.error(
    "❌ Error: Database connection string not found. Please set PROD_STORAGE_POSTGRES_URL or DEV_STORAGE_POSTGRES_URL in .env.local"
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ["error", "warn"],
});

const WALLET_TYPES: WalletType[] = [
  WalletType.DEV,
  WalletType.VOLUME,
  WalletType.DISTRIBUTION,
];

async function insertTestWallets() {
  try {
    console.log("🔍 Fetching all tokens from database...\n");

    const tokens = await prisma.token.findMany({
      include: {
        operationalWallets: true,
        devWallets: {
          include: {
            wallet: true,
          },
        },
      },
    });

    if (tokens.length === 0) {
      console.log("❌ No tokens found in the database.");
      return;
    }

    console.log(`📊 Found ${tokens.length} token(s)\n`);

    let totalWalletsCreated = 0;
    let totalWalletsSkipped = 0;

    for (const token of tokens) {
      console.log(
        `\n🪙 Processing token: ${token.name} (${token.symbol}) - ${token.publicKey}`
      );
      const existingWalletsCount =
        token.operationalWallets.length + token.devWallets.length;
      console.log(`   Existing wallets: ${existingWalletsCount}`);

      const existingWalletTypes = new Set([
        ...token.operationalWallets.map((wallet) => wallet.type),
        ...token.devWallets.map((entry) => entry.wallet.type),
      ]);

      for (const walletType of WALLET_TYPES) {
        if (existingWalletTypes.has(walletType)) {
          console.log(`   ⏭️  Skipping ${walletType} wallet (already exists)`);
          totalWalletsSkipped++;
          continue;
        }

        const keypair = Keypair.generate();
        const publicKey = keypair.publicKey.toBase58();
        const privateKey = bs58.encode(keypair.secretKey);

        try {
          const wallet = await prisma.wallet.create({
            data: {
              publicKey,
              privateKey,
              type: walletType,
              ...(walletType === WalletType.DEV
                ? {}
                : {
                    token: {
                      connect: {
                        publicKey: token.publicKey,
                      },
                    },
                  }),
            },
          });

          if (walletType === WalletType.DEV) {
            await prisma.tokenDevWallet.create({
              data: {
                tokenPublicKey: token.publicKey,
                walletPublicKey: wallet.publicKey,
              },
            });
          }

          console.log(
            `   ✅ Created ${walletType} wallet: ${publicKey.substring(
              0,
              8
            )}...`
          );
          totalWalletsCreated++;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("Unique constraint")
          ) {
            console.log(
              `   ⚠️  Wallet ${publicKey.substring(
                0,
                8
              )}... already exists (skipping)`
            );
            totalWalletsSkipped++;
          } else {
            console.error(
              `   ❌ Error creating ${walletType} wallet:`,
              error instanceof Error ? error.message : error
            );
          }
        }
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("📈 Summary:");
    console.log(`   ✅ Wallets created: ${totalWalletsCreated}`);
    console.log(`   ⏭️  Wallets skipped: ${totalWalletsSkipped}`);
    console.log("=".repeat(50) + "\n");
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

insertTestWallets();
