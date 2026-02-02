import { Program, type AnchorProvider, type Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";

export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

let idlCache: Idl | null = null;

function loadPumpIdl() {
  if (idlCache) {
    return idlCache;
  }

  const idlPath = path.resolve(process.cwd(), "data", "pump.json");
  const idlRaw = fs.readFileSync(idlPath, "utf8");
  const parsed = JSON.parse(idlRaw) as Idl;
  parsed.accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  parsed.types = Array.isArray(parsed.types) ? parsed.types : [];
  parsed.address = parsed.address ?? PUMP_PROGRAM_ID.toBase58();
  parsed.metadata = parsed.metadata ?? {
    name: "pump",
    version: "0.1.0",
    spec: "0.1.0",
  };
  idlCache = parsed;
  return idlCache;
}

export function getPumpProgram(provider: AnchorProvider) {
  const idl = loadPumpIdl();
  try {
    return new Program(idl as Idl, provider);
  } catch {
    const minimal = { ...idl, accounts: [] as unknown[] } as Idl;
    return new Program(minimal, provider);
  }
}

export function getPumpIdl() {
  return loadPumpIdl();
}
