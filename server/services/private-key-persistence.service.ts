import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { logger } from "@/lib/logger";

type PersistGeneratedPrivateKeyInput = {
  service: string;
  operation: string;
  publicKey: string;
  privateKey: string;
};

const GENERATED_KEYS_DIRECTORY = path.resolve(process.cwd(), ".keys");
const GENERATED_KEYS_FILE_PATH = path.join(
  GENERATED_KEYS_DIRECTORY,
  "generated-private-keys.jsonl"
);

let ensureDirectoryPromise: Promise<void> | null = null;

const ensureGeneratedKeysDirectory = async () => {
  if (!ensureDirectoryPromise) {
    ensureDirectoryPromise = mkdir(GENERATED_KEYS_DIRECTORY, { recursive: true })
      .then(() => undefined)
      .catch((error) => {
        ensureDirectoryPromise = null;
        throw error;
      });
  }
  await ensureDirectoryPromise;
};

export const persistGeneratedPrivateKey = async (
  input: PersistGeneratedPrivateKeyInput
) => {
  try {
    await ensureGeneratedKeysDirectory();
    const record = {
      timestamp: new Date().toISOString(),
      service: input.service,
      operation: input.operation,
      publicKey: input.publicKey,
      privateKey: input.privateKey,
    };
    await appendFile(GENERATED_KEYS_FILE_PATH, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    logger.warn("Failed to persist generated private key locally", {
      error,
      service: input.service,
      operation: input.operation,
      publicKey: input.publicKey,
    });
  }
};
