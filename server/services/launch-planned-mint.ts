import "server-only";

import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";

export type LaunchPlannedMintRecord = {
  id: string;
  launchId: string;
  publicKey: string;
  privateKey: string;
  vanityMintId: string | null;
  consumedAt: Date | null;
  abandonedAt: Date | null;
};

const plannedMintSelect = {
  id: true,
  launchId: true,
  publicKey: true,
  privateKey: true,
  vanityMintId: true,
  consumedAt: true,
  abandonedAt: true,
} as const;

/**
 * Persist plan-time mint identity for a Launch.
 * Secrets stay on this row; Launch.plan optionsOutcomes stay secret-free.
 */
export async function createLaunchPlannedMint(params: {
  launchId: string;
  publicKey: string;
  privateKey: string;
  vanityMintId?: string | null;
}): Promise<LaunchPlannedMintRecord> {
  return await prisma.launchPlannedMint.create({
    data: {
      launchId: params.launchId,
      publicKey: params.publicKey,
      privateKey: params.privateKey,
      vanityMintId: params.vanityMintId ?? null,
    },
    select: plannedMintSelect,
  });
}

/**
 * Load a planned mint for execute. Rejects abandoned or already-consumed rows.
 */
export async function requireActiveLaunchPlannedMint(
  plannedMintId: string
): Promise<LaunchPlannedMintRecord> {
  const row = await prisma.launchPlannedMint.findUnique({
    where: { id: plannedMintId },
    select: plannedMintSelect,
  });
  if (!row) {
    throw new AppError("Planned mint is missing from the authoritative plan", 500);
  }
  if (row.abandonedAt) {
    throw new AppError("Planned mint was abandoned and cannot be executed", 400);
  }
  if (row.consumedAt) {
    throw new AppError("Planned mint was already consumed", 400);
  }
  return row;
}

/**
 * Mark a planned mint abandoned after plan persist / insufficient-funds failure.
 * Returns the linked vanity pool id (if any) so lifecycle can release it.
 */
export async function abandonLaunchPlannedMint(
  plannedMintId: string
): Promise<{ vanityMintId: string | null }> {
  const existing = await prisma.launchPlannedMint.findUnique({
    where: { id: plannedMintId },
    select: {
      id: true,
      vanityMintId: true,
      consumedAt: true,
      abandonedAt: true,
    },
  });
  if (!existing || existing.consumedAt || existing.abandonedAt) {
    return { vanityMintId: existing?.vanityMintId ?? null };
  }

  const updated = await prisma.launchPlannedMint.update({
    where: { id: plannedMintId },
    data: { abandonedAt: new Date() },
    select: { vanityMintId: true },
  });
  return { vanityMintId: updated.vanityMintId };
}

/**
 * Mark a planned mint consumed after confirmed on-chain create.
 */
export async function markLaunchPlannedMintConsumed(
  plannedMintId: string
): Promise<void> {
  await prisma.launchPlannedMint.updateMany({
    where: {
      id: plannedMintId,
      abandonedAt: null,
      consumedAt: null,
    },
    data: { consumedAt: new Date() },
  });
}
