import "server-only";

import type {
  LaunchOptions,
  LaunchOptionsOutcomesV1,
} from "@/server/schemas/launch-platform.schema";
import type { LaunchPlatformPlanLocalResources } from "@/server/services/launch-platform-registry";

export type MaterializeLaunchOptionsResult = {
  optionsOutcomes: LaunchOptionsOutcomesV1;
  localResources: Pick<LaunchPlatformPlanLocalResources, "reservedVanityMintId">;
};

/**
 * Materialize Launch Options for a plan attempt: reserve a vanity mint when
 * requested. Fresh mint keypairs are created at execute via the shared mint helper.
 */
export async function materializeLaunchOptionsOutcomes(params: {
  launchId: string;
  userId: string;
  options: LaunchOptions;
}): Promise<MaterializeLaunchOptionsResult> {
  if (!params.options.vanityMint) {
    return {
      optionsOutcomes: {
        vanityMint: false,
        removeAttribution: params.options.removeAttribution,
        reservedVanityMintId: null,
        reservedVanityMintPublicKey: null,
      },
      localResources: { reservedVanityMintId: null },
    };
  }

  const { reserveMintForLaunchOptions } = await import("./launch.service");
  const reserved = await reserveMintForLaunchOptions(
    params.launchId,
    params.userId,
    true
  );

  return {
    optionsOutcomes: {
      vanityMint: true,
      removeAttribution: params.options.removeAttribution,
      reservedVanityMintId: reserved.reservedVanityId,
      reservedVanityMintPublicKey: reserved.mintKeypair.publicKey.toBase58(),
    },
    localResources: {
      reservedVanityMintId: reserved.reservedVanityId,
    },
  };
}
