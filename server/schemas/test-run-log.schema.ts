import { z } from "zod";

export const appendTestRunLogEventSchema = z.object({
  eventType: z.string().min(1, "Event type is required"),
  source: z.string().min(1).optional(),
  tokenPublicKey: z.string().min(1).optional(),
  page: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  wallets: z.unknown().optional(),
  balancesBefore: z.unknown().optional(),
  balancesAfter: z.unknown().optional(),
  expectedValue: z.unknown().optional(),
  actualValue: z.unknown().optional(),
  delta: z.unknown().optional(),
  notes: z.unknown().optional(),
  status: z.string().min(1).optional(),
  trigger: z.string().min(1).optional(),
  durationMs: z.number().finite().nonnegative().optional(),
  signature: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  launchId: z.string().min(1).optional(),
  refreshMode: z.string().min(1).optional(),
  dataSource: z.string().min(1).optional(),
  cache: z.unknown().optional(),
  summary: z.unknown().optional(),
  snapshot: z.unknown().optional(),
  error: z.unknown().optional(),
});

export type AppendTestRunLogEventInput = z.infer<
  typeof appendTestRunLogEventSchema
>;
