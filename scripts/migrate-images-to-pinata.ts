#!/usr/bin/env tsx

import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/config/env";
import { storageService } from "@/server/services/storage.service";

const BATCH_SIZE = 10;
const DELAY_MS = 300;

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function run() {
  const { PINATA_JWT } = getEnv();
  if (!PINATA_JWT) {
    throw new Error("PINATA_JWT is required for this migration");
  }

  const total = await prisma.token.count({
    where: {
      imageUrl: {
        startsWith: "data:",
      },
    },
  });

  if (total === 0) {
    console.log("No base64 token images found.");
    return;
  }

  console.log(`Found ${total} base64 token images to migrate.`);
  let migrated = 0;
  let failed = 0;

  while (true) {
    const tokens = await prisma.token.findMany({
      where: {
        imageUrl: {
          startsWith: "data:",
        },
      },
      select: {
        publicKey: true,
        symbol: true,
        imageUrl: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: BATCH_SIZE,
    });

    if (tokens.length === 0) {
      break;
    }

    for (const token of tokens) {
      if (!token.imageUrl?.startsWith("data:")) {
        continue;
      }

      try {
        const uploadedUrl = await storageService.uploadImage(
          token.imageUrl,
          token.symbol || token.publicKey
        );

        if (uploadedUrl === token.imageUrl) {
          throw new Error("Token image upload did not produce a new URL");
        }

        await prisma.token.update({
          where: {
            publicKey: token.publicKey,
          },
          data: {
            imageUrl: uploadedUrl,
          },
        });

        migrated += 1;
        console.log(`[${migrated + failed}/${total}] migrated ${token.publicKey}`);
      } catch (error) {
        failed += 1;
        console.error(
          `[${migrated + failed}/${total}] failed ${token.publicKey}:`,
          toErrorMessage(error)
        );
      }

      await sleep(DELAY_MS);
    }
  }

  console.log(`Migration complete. Migrated: ${migrated}, failed: ${failed}`);
}

run()
  .catch((error) => {
    console.error("Migration failed:", toErrorMessage(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
