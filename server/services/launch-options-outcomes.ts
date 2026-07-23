import "server-only";

import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import type {
  LaunchOptions,
  LaunchOptionsOutcomesV1,
} from "@/server/schemas/launch-platform.schema";
import {
  abandonLaunchPlannedMint,
  createLaunchPlannedMint,
} from "@/server/services/launch-planned-mint";
import { persistGeneratedPrivateKey } from "@/server/services/private-key-persistence.service";

export type LaunchOptionsLocalResources = {
  plannedMintId: string | null;
  reservedVanityMintId: string | null;
};

export type MaterializeLaunchOptionsResult = {
  optionsOutcomes: LaunchOptionsOutcomesV1;
  localResources: LaunchOptionsLocalResources;
};

/**
 * Materialize Launch Options for a plan attempt.
 * Every Launch gets a LaunchPlannedMint row (vanity pool reserve or fresh key).
 * Envelope optionsOutcomes stay secret-free.
 */
export async function materializeLaunchOptionsOutcomes(params: {
  launchId: string;
  userId: string;
  options: LaunchOptions;
}): Promise<MaterializeLaunchOptionsResult> {
  if (!params.options.vanityMint) {
    const mintKeypair = Keypair.generate();
    const publicKey = mintKeypair.publicKey.toBase58();
    const privateKey = bs58.encode(mintKeypair.secretKey);
    await persistGeneratedPrivateKey({
      service: "launchOptionsOutcomes",
      operation: "materializeLaunchOptionsOutcomes.generate",
      publicKey,
      privateKey,
    });
    const planned = await createLaunchPlannedMint({
      launchId: params.launchId,
      publicKey,
      privateKey,
      vanityMintId: null,
    });
    return {
      optionsOutcomes: {
        vanityMint: false,
        removeAttribution: params.options.removeAttribution,
        mintPublicKey: publicKey,
        plannedMintId: planned.id,
        reservedVanityMintId: null,
      },
      localResources: {
        plannedMintId: planned.id,
        reservedVanityMintId: null,
      },
    };
  }

  const {
    releaseReservedVanityMintForLaunchOptions,
    reserveMintForLaunchOptions,
  } = await import("./launch.service");
  const reserved = await reserveMintForLaunchOptions(
    params.launchId,
    params.userId,
    true
  );
  const publicKey = reserved.mintKeypair.publicKey.toBase58();
  const privateKey = bs58.encode(reserved.mintKeypair.secretKey);
  try {
    const planned = await createLaunchPlannedMint({
      launchId: params.launchId,
      publicKey,
      privateKey,
      vanityMintId: reserved.reservedVanityId,
    });

    return {
      optionsOutcomes: {
        vanityMint: true,
        removeAttribution: params.options.removeAttribution,
        mintPublicKey: publicKey,
        plannedMintId: planned.id,
        reservedVanityMintId: reserved.reservedVanityId,
      },
      localResources: {
        plannedMintId: planned.id,
        reservedVanityMintId: reserved.reservedVanityId,
      },
    };
  } catch (error) {
    if (reserved.reservedVanityId) {
      await releaseReservedVanityMintForLaunchOptions(reserved.reservedVanityId);
    }
    throw error;
  }
}

/**
 * Lifecycle-owned compensation for Launch Options resources.
 * Abandons the planned mint and releases any vanity pool reservation.
 * Platforms do not own this path.
 */
export async function compensateLaunchOptionsResources(
  resources: LaunchOptionsLocalResources | undefined
): Promise<void> {
  if (!resources?.plannedMintId && !resources?.reservedVanityMintId) {
    return;
  }

  let vanityMintId = resources.reservedVanityMintId;
  if (resources.plannedMintId) {
    const abandoned = await abandonLaunchPlannedMint(resources.plannedMintId);
    vanityMintId = vanityMintId ?? abandoned.vanityMintId;
  }

  if (vanityMintId) {
    const { releaseReservedVanityMintForLaunchOptions } = await import(
      "./launch.service"
    );
    await releaseReservedVanityMintForLaunchOptions(vanityMintId);
  }
}
