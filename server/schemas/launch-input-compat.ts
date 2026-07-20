import {
  LAUNCH_INPUT_SCHEMA_VERSION_V1,
  LAUNCH_PLATFORM_VERSION_V1,
  versionedLaunchInputSchema,
  type VersionedLaunchInput,
} from "./launch-platform.schema";
import {
  launchInputFromStorageSchema,
  type LaunchInputFromStorage,
  type LaunchTokenInput,
} from "./launch.schema";

export type LaunchEntitlementSnapshot = {
  plan: string;
  launchRealtimeEnabled: boolean;
  platformFeeWaived: boolean;
};

export type VersionedStoredLaunchInput = VersionedLaunchInput & {
  entitlementSnapshot?: LaunchEntitlementSnapshot;
};

export type ResolvedStoredLaunchInput = LaunchInputFromStorage & {
  entitlementSnapshot?: LaunchEntitlementSnapshot;
};

export type NewLaunchPersistence = {
  platform: "PUMPFUN";
  platformVersion: typeof LAUNCH_PLATFORM_VERSION_V1;
  input: VersionedStoredLaunchInput;
};

function asEntitlementSnapshot(
  value: unknown
): LaunchEntitlementSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.plan !== "string" ||
    typeof record.launchRealtimeEnabled !== "boolean" ||
    typeof record.platformFeeWaived !== "boolean"
  ) {
    return undefined;
  }
  return {
    plan: record.plan,
    launchRealtimeEnabled: record.launchRealtimeEnabled,
    platformFeeWaived: record.platformFeeWaived,
  };
}

function splitEntitlement(raw: unknown): {
  body: unknown;
  entitlementSnapshot?: LaunchEntitlementSnapshot;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { body: raw };
  }
  const { entitlementSnapshot, ...body } = raw as Record<string, unknown>;
  return {
    body,
    entitlementSnapshot: asEntitlementSnapshot(entitlementSnapshot),
  };
}

/** Map versioned pump.fun submission fields onto the flat execution input shape. */
export function flattenVersionedLaunchInput(
  input: VersionedLaunchInput
): LaunchTokenInput {
  return {
    tokenName: input.metadata.tokenName,
    tokenSymbol: input.metadata.tokenSymbol,
    description: input.metadata.description,
    tokenImage: input.metadata.tokenImage,
    tokenBanner: input.metadata.tokenBanner,
    twitter: input.metadata.twitter,
    telegram: input.metadata.telegram,
    website: input.metadata.website,
    devWalletOption: input.config.devWalletOption,
    importedDevWalletKey: input.config.importedDevWalletKey,
    devBuyAmountSol: input.config.devBuyAmountSol,
    jitoTipAmountSol: input.config.jitoTipAmountSol,
    bundleBuyEnabled: input.config.bundleBuyEnabled,
    vanityMint: input.config.vanityMint,
    removeAttribution: input.config.removeAttribution,
    mayhemMode: input.config.mayhemMode,
    bundlerWalletCount: input.config.bundlerWalletCount,
    bundlerBuyAmountSol: input.config.bundlerBuyAmountSol,
    bundlerBuyVariancePercent: input.config.bundlerBuyVariancePercent,
    distributionWalletMultiplier: input.config.distributionWalletMultiplier,
  };
}

/** Nest flat pump.fun fields into the versioned discriminated submission shape. */
export function toVersionedLaunchInput(
  flat: LaunchTokenInput
): VersionedLaunchInput {
  return {
    schemaVersion: LAUNCH_INPUT_SCHEMA_VERSION_V1,
    platform: "PUMPFUN",
    metadata: {
      tokenName: flat.tokenName,
      tokenSymbol: flat.tokenSymbol,
      tokenImage: flat.tokenImage,
      ...(flat.description !== undefined
        ? { description: flat.description }
        : {}),
      ...(flat.tokenBanner !== undefined
        ? { tokenBanner: flat.tokenBanner }
        : {}),
      ...(flat.twitter !== undefined ? { twitter: flat.twitter } : {}),
      ...(flat.telegram !== undefined ? { telegram: flat.telegram } : {}),
      ...(flat.website !== undefined ? { website: flat.website } : {}),
    },
    config: {
      devWalletOption: flat.devWalletOption,
      ...(flat.importedDevWalletKey !== undefined
        ? { importedDevWalletKey: flat.importedDevWalletKey }
        : {}),
      devBuyAmountSol: flat.devBuyAmountSol,
      jitoTipAmountSol: flat.jitoTipAmountSol,
      bundleBuyEnabled: flat.bundleBuyEnabled,
      vanityMint: flat.vanityMint,
      removeAttribution: flat.removeAttribution,
      mayhemMode: flat.mayhemMode ?? false,
      bundlerWalletCount: flat.bundlerWalletCount,
      bundlerBuyAmountSol: flat.bundlerBuyAmountSol,
      bundlerBuyVariancePercent: flat.bundlerBuyVariancePercent,
      distributionWalletMultiplier: flat.distributionWalletMultiplier,
    },
  };
}

/**
 * Persistence payload for schema-valid new Launch submissions.
 * Sets explicit Platform identity and stores the versioned input contract.
 */
export function buildNewLaunchPersistence(
  versioned: VersionedLaunchInput,
  entitlementSnapshot: LaunchEntitlementSnapshot
): NewLaunchPersistence {
  return {
    platform: "PUMPFUN",
    platformVersion: LAUNCH_PLATFORM_VERSION_V1,
    input: {
      ...versioned,
      entitlementSnapshot,
    },
  };
}

/**
 * Resolve persisted Launch.input for execution / retry / clone.
 * Supports versioned new-shape rows and legacy flat rows without migrating JSON.
 */
export function resolveStoredLaunchInput(
  raw: unknown
): ResolvedStoredLaunchInput | null {
  const { body, entitlementSnapshot } = splitEntitlement(raw);

  const versioned = versionedLaunchInputSchema.safeParse(body);
  if (versioned.success) {
    return {
      ...flattenVersionedLaunchInput(versioned.data),
      ...(entitlementSnapshot ? { entitlementSnapshot } : {}),
    };
  }

  const flat = launchInputFromStorageSchema.safeParse(body);
  if (flat.success) {
    return {
      ...flat.data,
      ...(entitlementSnapshot ? { entitlementSnapshot } : {}),
    };
  }

  return null;
}

/** Safe display fields from either versioned or legacy flat Launch.input. */
export function launchInputDisplayFields(raw: unknown): {
  tokenName: string | null;
  tokenSymbol: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
} {
  const resolved = resolveStoredLaunchInput(raw);
  if (!resolved) {
    return {
      tokenName: null,
      tokenSymbol: null,
      website: null,
      twitter: null,
      telegram: null,
    };
  }
  return {
    tokenName: resolved.tokenName,
    tokenSymbol: resolved.tokenSymbol,
    website: resolved.website?.trim() || null,
    twitter: resolved.twitter?.trim() || null,
    telegram: resolved.telegram?.trim() || null,
  };
}
