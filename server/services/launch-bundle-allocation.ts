import "server-only";
type FixedTotalBundleAllocationParams = {
  walletCount: number;
  totalLamports: bigint;
  targetLamportsPerWallet: bigint;
  variancePercent: number;
  minLamportsPerWallet: bigint;
  seed: string;
};

export type FixedTotalBundleAllocation = {
  amountLamportsByWallet: bigint[];
  lowerBoundLamports: bigint;
  upperBoundLamports: bigint;
  usedFallback: boolean;
};

function bigintToSafeNumber(value: bigint) {
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Lamport value exceeds safe integer range");
  }

  return Number(value);
}

function hashSeed(seed: string) {
  let hash = 2166136261;

  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seed: string) {
  let state = hashSeed(seed) || 1;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleIndices(count: number, random: () => number) {
  const indices = Array.from({ length: count }, (_, index) => index);

  for (let i = indices.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(random() * (i + 1));
    [indices[i], indices[swapIndex]] = [indices[swapIndex], indices[i]];
  }

  return indices;
}

function randomIntBetween(min: number, max: number, random: () => number) {
  if (max <= min) {
    return min;
  }

  return Math.floor(random() * (max - min + 1)) + min;
}

export function allocateFixedTotalBundleLamports(
  params: FixedTotalBundleAllocationParams
): FixedTotalBundleAllocation {
  const walletCount = Math.max(0, Math.floor(params.walletCount));
  if (walletCount === 0) {
    return {
      amountLamportsByWallet: [],
      lowerBoundLamports: BigInt(0),
      upperBoundLamports: BigInt(0),
      usedFallback: false,
    };
  }

  const totalLamports = bigintToSafeNumber(params.totalLamports);
  const targetLamportsPerWallet = bigintToSafeNumber(params.targetLamportsPerWallet);
  const minLamportsPerWallet = bigintToSafeNumber(params.minLamportsPerWallet);
  const varianceRatio = Math.max(0, params.variancePercent) / 100;
  const averageFloor = Math.floor(totalLamports / walletCount);
  const averageCeil = Math.ceil(totalLamports / walletCount);
  let lowerBound = Math.max(
    minLamportsPerWallet,
    Math.floor(targetLamportsPerWallet * (1 - varianceRatio))
  );
  let upperBound = Math.max(
    lowerBound,
    Math.floor(targetLamportsPerWallet * (1 + varianceRatio))
  );
  let usedFallback = false;

  if (lowerBound * walletCount > totalLamports || upperBound * walletCount < totalLamports) {
    lowerBound = averageFloor;
    upperBound = averageCeil;
    usedFallback = true;
  }

  const random = createSeededRandom(params.seed);
  const shuffledIndices = shuffleIndices(walletCount, random);
  const amountByWallet = Array.from({ length: walletCount }, () => lowerBound);
  let remainingLamports = totalLamports - lowerBound * walletCount;

  for (let position = 0; position < shuffledIndices.length; position += 1) {
    const walletIndex = shuffledIndices[position];
    const walletsRemaining = shuffledIndices.length - position - 1;
    const maxExtraForWallet = upperBound - lowerBound;
    const minExtraForWallet = Math.max(
      0,
      remainingLamports - walletsRemaining * maxExtraForWallet
    );
    const maxAssignableForWallet = Math.min(maxExtraForWallet, remainingLamports);
    const extraLamports =
      walletsRemaining === 0
        ? remainingLamports
        : randomIntBetween(minExtraForWallet, maxAssignableForWallet, random);

    amountByWallet[walletIndex] += extraLamports;
    remainingLamports -= extraLamports;
  }

  return {
    amountLamportsByWallet: amountByWallet.map((amount) => BigInt(amount)),
    lowerBoundLamports: BigInt(lowerBound),
    upperBoundLamports: BigInt(upperBound),
    usedFallback,
  };
}
