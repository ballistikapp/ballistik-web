import { Program, type AnchorProvider, type Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

const PRIMITIVE_TYPES = new Set([
  "bool",
  "u8",
  "i8",
  "u16",
  "i16",
  "u32",
  "i32",
  "f32",
  "u64",
  "i64",
  "f64",
  "u128",
  "i128",
  "u256",
  "i256",
  "bytes",
  "string",
  "pubkey",
]);

let idlCache: Idl | null = null;

function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function instructionDiscriminator(name: string): number[] {
  const preimage = `global:${toSnakeCase(name)}`;
  return [
    ...crypto.createHash("sha256").update(preimage).digest().subarray(0, 8),
  ];
}

function accountDiscriminator(pascalName: string): number[] {
  const preimage = `account:${pascalName}`;
  return [
    ...crypto.createHash("sha256").update(preimage).digest().subarray(0, 8),
  ];
}

function eventDiscriminator(pascalName: string): number[] {
  const preimage = `event:${pascalName}`;
  return [
    ...crypto.createHash("sha256").update(preimage).digest().subarray(0, 8),
  ];
}

function mapFieldType(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(mapFieldType);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "fieldType") {
      out.type = mapFieldType(v);
      continue;
    }
    out[k] = mapFieldType(v);
  }
  return out;
}

function normalizeTypeRef(t: unknown): unknown {
  if (typeof t !== "string") {
    if (t && typeof t === "object" && !Array.isArray(t)) {
      const o = t as Record<string, unknown>;
      if ("vec" in o) {
        return { vec: normalizeTypeRef(o.vec) };
      }
      if ("array" in o) {
        const tuple = o.array as [unknown, number];
        return { array: [normalizeTypeRef(tuple[0]), tuple[1]] };
      }
      if ("option" in o) {
        return { option: normalizeTypeRef(o.option) };
      }
      if ("defined" in o) {
        return t;
      }
    }
    return t;
  }
  if (PRIMITIVE_TYPES.has(t)) {
    return t;
  }
  const vecMatch = /^vec\((.+)\)$/.exec(t);
  if (vecMatch) {
    return { vec: normalizeTypeRef(vecMatch[1].trim()) };
  }
  const arrMatch = /^array\(([^,]+),\s*(\d+)\)$/.exec(t);
  if (arrMatch) {
    return {
      array: [normalizeTypeRef(arrMatch[1].trim()), Number(arrMatch[2])],
    };
  }
  return { defined: { name: t } };
}

function fixEnumVariants(node: unknown): void {
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      fixEnumVariants(item);
    }
    return;
  }
  const n = node as { kind?: string; variants?: unknown[] };
  if (
    n.kind === "enum" &&
    Array.isArray(n.variants) &&
    n.variants.length > 0 &&
    typeof n.variants[0] === "string"
  ) {
    n.variants = (n.variants as string[]).map((name) => ({ name }));
  }
  for (const v of Object.values(node)) {
    fixEnumVariants(v);
  }
}

function normalizeFieldTypes(node: unknown): void {
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      normalizeFieldTypes(item);
    }
    return;
  }
  const o = node as {
    fields?: { type?: unknown }[];
    variants?: { fields?: { type?: unknown }[] }[];
  };
  if (Array.isArray(o.fields)) {
    for (const f of o.fields) {
      if (f && typeof f === "object" && "type" in f && f.type !== undefined) {
        f.type = normalizeTypeRef(f.type);
      }
    }
  }
  if (Array.isArray(o.variants)) {
    for (const v of o.variants) {
      if (v && typeof v === "object" && Array.isArray(v.fields)) {
        for (const f of v.fields) {
          if (
            f &&
            typeof f === "object" &&
            "type" in f &&
            f.type !== undefined
          ) {
            f.type = normalizeTypeRef(f.type);
          }
        }
      }
    }
  }
  for (const v of Object.values(node)) {
    normalizeFieldTypes(v);
  }
}

function nameUnnamedStructFields(node: unknown): void {
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      nameUnnamedStructFields(item);
    }
    return;
  }
  const n = node as { kind?: string; fields?: { name?: string }[] };
  if (n.kind === "struct" && Array.isArray(n.fields)) {
    n.fields = n.fields.map((f, i) => {
      if (f && f.name) {
        return f;
      }
      return { ...f, name: `_${i}` };
    });
  }
  for (const v of Object.values(node)) {
    nameUnnamedStructFields(v);
  }
}

type ParsedPumpJson = {
  accounts?: unknown[];
  types?: unknown[];
  events?: unknown[];
  instructions?: unknown[];
};

/**
 * `data/pump.json` uses Anchor's newer IDL export shape (`fieldType`, shorthand
 * types like `vec(Fee)`). `@coral-xyz/anchor` 0.30 expects the classic layout
 * (`type`, `defined`/`vec`/`array` objects, instruction discriminators, etc.).
 */
/**
 * pump.json marks some instruction accounts with `pda: true` (boolean). Anchor's
 * resolver expects `pda: { seeds: [...] }`; a truthy boolean makes it loop
 * until "maximum depth for account resolution" without ever filling the account.
 */
function stripBooleanPdaFromInstructionAccounts(
  accounts: unknown[] | undefined
): void {
  if (!accounts) {
    return;
  }
  for (const item of accounts) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const acc = item as Record<string, unknown>;
    if ("accounts" in acc && Array.isArray(acc.accounts)) {
      stripBooleanPdaFromInstructionAccounts(acc.accounts as unknown[]);
      continue;
    }
    if (typeof acc.pda === "boolean") {
      delete acc.pda;
    }
  }
}

function normalizeRawPumpIdl(raw: ParsedPumpJson): Idl {
  const accountDefs = (raw.accounts ?? []).map((a) =>
    mapFieldType({ ...(a as object) })
  ) as { name: string; type: unknown }[];
  const typesFromFile = (raw.types ?? []).map((t) =>
    mapFieldType({ ...(t as object) })
  ) as { name: string; type: unknown }[];
  const eventsRaw = (raw.events ?? []).map((e) =>
    mapFieldType({ ...(e as object) })
  ) as { name: string; type: unknown }[];

  const instructions = (raw.instructions ?? []).map((ix) => {
    const ix2 = mapFieldType({ ...(ix as object) }) as {
      name: string;
      accounts?: unknown[];
      args?: { rawType?: unknown; type?: unknown }[];
      discriminator?: number[];
    };
    ix2.args = (ix2.args ?? []).map((arg) => {
      const mapped = mapFieldType(arg);
      if (typeof mapped !== "object" || mapped === null) {
        throw new Error("Invalid pump IDL: instruction arg must be an object");
      }
      const a = { ...(mapped as Record<string, unknown>) } as {
        rawType?: unknown;
        type?: unknown;
      };
      if (a.rawType !== undefined) {
        a.type = mapFieldType(a.rawType) as typeof a.type;
        delete a.rawType;
      }
      return a;
    });
    ix2.discriminator = instructionDiscriminator(ix2.name);
    stripBooleanPdaFromInstructionAccounts(ix2.accounts as unknown[]);
    return ix2;
  });

  const typesByName = new Map<string, { name: string; type: unknown }>();
  for (const t of typesFromFile) {
    typesByName.set(t.name, t);
  }
  for (const a of accountDefs) {
    if (!typesByName.has(a.name)) {
      typesByName.set(a.name, { name: a.name, type: a.type });
    }
  }
  for (const e of eventsRaw) {
    if (!typesByName.has(e.name)) {
      typesByName.set(e.name, { name: e.name, type: e.type });
    }
  }

  const accounts = accountDefs.map((a) => ({
    name: a.name,
    discriminator: accountDiscriminator(a.name),
  }));
  const events = eventsRaw.map((e) => ({
    name: e.name,
    discriminator: eventDiscriminator(e.name),
  }));

  const idl = {
    address: PUMP_PROGRAM_ID.toBase58(),
    metadata: {
      name: "pump",
      version: "0.1.0",
      spec: "0.1.0",
    },
    instructions,
    accounts,
    types: [...typesByName.values()],
    events,
  } as Idl;

  fixEnumVariants(idl);
  normalizeFieldTypes(idl);
  nameUnnamedStructFields(idl);
  return idl;
}

function loadPumpIdl() {
  if (idlCache) {
    return idlCache;
  }

  const idlPath = path.resolve(process.cwd(), "data", "pump.json");
  const idlRaw = fs.readFileSync(idlPath, "utf8");
  const parsed = JSON.parse(idlRaw) as ParsedPumpJson;
  idlCache = normalizeRawPumpIdl(parsed);
  return idlCache;
}

export function getPumpProgram(provider: AnchorProvider) {
  const idl = loadPumpIdl();
  return new Program(idl, provider);
}

export function getPumpIdl() {
  return loadPumpIdl();
}
