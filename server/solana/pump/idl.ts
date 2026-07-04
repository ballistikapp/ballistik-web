import "server-only";
import {
  BorshAccountsCoder,
  BorshCoder,
  EventParser,
  type Idl,
} from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import idlJson from "@/data/pumpfun-idl.json";

export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

type IdlTypeDef = {
  name: string;
  type?: { kind?: string; fields?: Array<{ name: string; type: unknown }> };
};

function findStructFields(
  idl: Idl,
  typeName: string
): Array<{ name: string; type: unknown }> {
  const types = (idl.types ?? []) as IdlTypeDef[];
  const def = types.find((t) => t.name === typeName);
  if (!def || def.type?.kind !== "struct" || !Array.isArray(def.type.fields)) {
    throw new Error(
      `pumpfun-idl.json schema drift: ${typeName} struct not found in idl.types`
    );
  }
  return def.type.fields;
}

function assertStructField(
  typeName: string,
  fields: Array<{ name: string; type: unknown }>,
  fieldName: string,
  expectedType: unknown
): void {
  const actual = fields.find((field) => field.name === fieldName)?.type;
  const matches = JSON.stringify(actual) === JSON.stringify(expectedType);
  if (!matches) {
    throw new Error(
      `pumpfun-idl.json schema drift: ${typeName}.${fieldName} expected ${JSON.stringify(expectedType)}, got ${JSON.stringify(actual) ?? "missing"}`
    );
  }
}

function validateIdlSchema(idl: Idl): void {
  if (idl.address !== PUMP_PROGRAM_ID.toBase58()) {
    throw new Error(
      `pumpfun-idl.json schema drift: address expected "${PUMP_PROGRAM_ID.toBase58()}", got "${idl.address}"`
    );
  }

  const globalFields = findStructFields(idl, "Global");
  assertStructField("Global", globalFields, "fee_basis_points", "u64");
  assertStructField(
    "Global",
    globalFields,
    "creator_fee_basis_points",
    "u64"
  );
  assertStructField("Global", globalFields, "buyback_basis_points", "u64");
  assertStructField("Global", globalFields, "buyback_fee_recipients", {
    array: ["pubkey", 8],
  });

  const tradeEventFields = findStructFields(idl, "TradeEvent");
  assertStructField("TradeEvent", tradeEventFields, "mint", "pubkey");
  assertStructField("TradeEvent", tradeEventFields, "user", "pubkey");
  assertStructField("TradeEvent", tradeEventFields, "sol_amount", "u64");
  assertStructField("TradeEvent", tradeEventFields, "token_amount", "u64");
  assertStructField("TradeEvent", tradeEventFields, "is_buy", "bool");
}

function loadIdl(): Idl {
  const idl = idlJson as unknown as Idl;
  validateIdlSchema(idl);
  return idl;
}

const PUMP_IDL = loadIdl();
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
