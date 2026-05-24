import "server-only";
import {
  BorshAccountsCoder,
  BorshCoder,
  EventParser,
  type Idl,
} from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import crypto from "crypto";

import idlJson from "@/data/pumpfun-idl.json";

export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

type RawIdlEntry = Record<string, unknown>;
type RawType = unknown;

const PRIMITIVE_TYPES = new Set([
  "bool",
  "u8",
  "u16",
  "u32",
  "u64",
  "u128",
  "u256",
  "i8",
  "i16",
  "i32",
  "i64",
  "i128",
  "i256",
  "f32",
  "f64",
  "string",
  "bytes",
  "pubkey",
  "publicKey",
]);

function discriminator(prefix: string, name: string): number[] {
  return Array.from(
    crypto.createHash("sha256").update(`${prefix}:${name}`).digest().slice(0, 8)
  );
}

function convertType(t: RawType, knownDefinedTypes: Set<string>): unknown {
  if (typeof t === "string") {
    if (PRIMITIVE_TYPES.has(t)) {
      return t === "publicKey" ? "pubkey" : t;
    }

    const arr = t.match(/^array\(\s*(.+?)\s*,\s*(\d+)\s*\)$/);
    if (arr) {
      return {
        array: [convertType(arr[1], knownDefinedTypes), Number.parseInt(arr[2], 10)],
      };
    }

    const vec = t.match(/^vec\(\s*(.+)\s*\)$/);
    if (vec) {
      return { vec: convertType(vec[1], knownDefinedTypes) };
    }

    const opt = t.match(/^option\(\s*(.+)\s*\)$/);
    if (opt) {
      return { option: convertType(opt[1], knownDefinedTypes) };
    }

    if (!knownDefinedTypes.has(t)) {
      throw new Error(`pumpfun-idl.json schema drift: unknown defined type "${t}"`);
    }

    return { defined: { name: t } };
  }

  if (t && typeof t === "object") {
    const obj = t as Record<string, unknown>;
    if (obj.kind === "struct") {
      const fields = Array.isArray(obj.fields) ? obj.fields : [];
      return {
        kind: "struct",
        fields: fields.map((f, index) =>
          convertField(f as Record<string, unknown>, knownDefinedTypes, index)
        ),
      };
    }
    if (obj.kind === "enum") {
      const variants = Array.isArray(obj.variants) ? obj.variants : [];
      return {
        kind: "enum",
        variants: variants.map((v) =>
          typeof v === "string" ? { name: v } : (v as Record<string, unknown>)
        ),
      };
    }

    throw new Error(
      `pumpfun-idl.json schema drift: unsupported IDL type object ${JSON.stringify(obj)}`
    );
  }

  throw new Error(
    `pumpfun-idl.json schema drift: unsupported IDL type ${String(t)}`
  );
}

function convertField(
  f: Record<string, unknown>,
  knownDefinedTypes: Set<string>,
  index = 0
): unknown {
  const name =
    typeof f.name === "string" && f.name.length > 0 ? f.name : `field${index}`;
  return { name, type: convertType(f.type, knownDefinedTypes) };
}

function getStructFields(entry: RawIdlEntry): Array<{ name: string; type: string }> {
  const fieldType = entry.fieldType as Record<string, unknown> | undefined;
  if (!fieldType || fieldType.kind !== "struct" || !Array.isArray(fieldType.fields)) {
    return [];
  }
  return fieldType.fields as Array<{ name: string; type: string }>;
}

function assertStructField(
  entryName: string,
  fields: Array<{ name: string; type: string }>,
  fieldName: string,
  expectedType: string
): void {
  const actual = fields.find((field) => field.name === fieldName)?.type;
  if (actual !== expectedType) {
    throw new Error(
      `pumpfun-idl.json schema drift: ${entryName}.${fieldName} expected "${expectedType}", got "${actual ?? "missing"}"`
    );
  }
}

function validateIdlSchema(raw: Record<string, unknown>): void {
  const rawAccounts = Array.isArray(raw.accounts)
    ? (raw.accounts as RawIdlEntry[])
    : [];
  const rawEvents = Array.isArray(raw.events)
    ? (raw.events as RawIdlEntry[])
    : [];

  const global = rawAccounts.find((entry) => entry.name === "Global");
  if (!global) {
    throw new Error("pumpfun-idl.json schema drift: Global account missing");
  }

  const globalFields = getStructFields(global);
  assertStructField("Global", globalFields, "feeBasisPoints", "u64");
  assertStructField("Global", globalFields, "creatorFeeBasisPoints", "u64");
  assertStructField("Global", globalFields, "buybackBasisPoints", "u64");
  assertStructField(
    "Global",
    globalFields,
    "buybackFeeRecipients",
    "array(pubkey, 8)"
  );

  const tradeEvent = rawEvents.find((entry) => entry.name === "TradeEvent");
  if (!tradeEvent) {
    throw new Error("pumpfun-idl.json schema drift: TradeEvent missing");
  }

  const tradeEventFields = getStructFields(tradeEvent);
  assertStructField("TradeEvent", tradeEventFields, "mint", "pubkey");
  assertStructField("TradeEvent", tradeEventFields, "user", "pubkey");
  assertStructField("TradeEvent", tradeEventFields, "solAmount", "u64");
  assertStructField("TradeEvent", tradeEventFields, "tokenAmount", "u64");
  assertStructField("TradeEvent", tradeEventFields, "isBuy", "bool");
}

function loadAndConvertIdl(): Idl {
  const raw = idlJson as Record<string, unknown>;

  if (!Array.isArray(raw.accounts)) {
    throw new Error("pumpfun-idl.json schema drift: accounts must be an array");
  }
  if (!Array.isArray(raw.events)) {
    throw new Error("pumpfun-idl.json schema drift: events must be an array");
  }
  if (!Array.isArray(raw.types)) {
    throw new Error("pumpfun-idl.json schema drift: types must be an array");
  }
  if (!Array.isArray(raw.errors)) {
    throw new Error("pumpfun-idl.json schema drift: errors must be an array");
  }

  validateIdlSchema(raw);

  const rawEvents = raw.events as RawIdlEntry[];
  const rawTypes = raw.types as RawIdlEntry[];
  const rawAccounts = raw.accounts as RawIdlEntry[];
  const rawErrors = raw.errors as RawIdlEntry[];

  const knownDefinedTypes = new Set<string>();
  for (const entry of [...rawTypes, ...rawAccounts, ...rawEvents]) {
    if (typeof entry.name === "string") {
      knownDefinedTypes.add(entry.name);
    }
  }

  const typeDefs: Array<{ name: string; type: unknown }> = [];
  for (const entry of rawTypes) {
    typeDefs.push({
      name: entry.name as string,
      type: convertType(entry.fieldType, knownDefinedTypes),
    });
  }
  for (const entry of rawAccounts) {
    typeDefs.push({
      name: entry.name as string,
      type: convertType(entry.fieldType, knownDefinedTypes),
    });
  }
  for (const entry of rawEvents) {
    typeDefs.push({
      name: entry.name as string,
      type: convertType(entry.fieldType, knownDefinedTypes),
    });
  }

  return {
    address: PUMP_PROGRAM_ID.toBase58(),
    metadata: { name: "pump", version: "0.1.0", spec: "0.1.0" },
    instructions: [],
    accounts: rawAccounts.map((a) => ({
      name: a.name as string,
      discriminator: discriminator("account", a.name as string),
    })),
    events: rawEvents.map((e) => ({
      name: e.name as string,
      discriminator: discriminator("event", e.name as string),
    })),
    errors: rawErrors.map((e) => ({
      code: Number.parseInt(e.code as string, 10),
      name: e.name as string,
      msg: (e.message as string) ?? "",
    })),
    types: typeDefs,
  } as unknown as Idl;
}

const PUMP_IDL = loadAndConvertIdl();
const PUMP_CODER = new BorshCoder(PUMP_IDL);
const PUMP_ACCOUNTS_CODER = PUMP_CODER.accounts;
const PUMP_EVENT_PARSER = new EventParser(PUMP_PROGRAM_ID, PUMP_CODER);

/** @deprecated Prefer getPumpCoder() / getPumpAccountsCoder() / getPumpEventParser(). */
export function getPumpIdl(): Idl {
  return PUMP_IDL;
}

export function getPumpCoder(): BorshCoder {
  return PUMP_CODER;
}

export function getPumpAccountsCoder(): BorshAccountsCoder {
  return PUMP_ACCOUNTS_CODER;
}

export function getPumpEventParser(): EventParser {
  return PUMP_EVENT_PARSER;
}
