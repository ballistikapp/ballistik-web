import "server-only";

import { AppError } from "@/server/errors";
import {
  LAUNCH_PLAN_SHELL_VERSION_V1,
  launchPlanEnvelopeV1Schema,
  type LaunchOptionsOutcomesV1,
  type LaunchPlanEnvelopeV1,
  type NormalizedLaunchMoneySummary,
} from "@/server/schemas/launch-platform.schema";

/**
 * Validate persisted Launch.plan as the shared envelope.
 * Launch.planSchemaVersion must match envelope.shellVersion.
 * Does not validate platformPlan — Platforms do that on execute/recover.
 */
export function requireLaunchPlanEnvelope(
  plan: unknown,
  planSchemaVersion: string | null
): LaunchPlanEnvelopeV1 {
  if (plan == null || planSchemaVersion == null) {
    throw new AppError(
      "Persisted launch plan is required before execute",
      500
    );
  }

  const parsed = launchPlanEnvelopeV1Schema.safeParse(plan);
  if (!parsed.success) {
    throw new AppError(
      "Persisted launch plan is invalid and cannot be executed",
      500,
      { issues: parsed.error.issues }
    );
  }

  if (parsed.data.shellVersion !== planSchemaVersion) {
    throw new AppError(
      "Persisted launch plan schema version does not match Launch record",
      500,
      {
        shellVersion: parsed.data.shellVersion,
        launchPlanSchemaVersion: planSchemaVersion,
      }
    );
  }

  return parsed.data;
}

export function assembleLaunchPlanEnvelope(params: {
  optionsOutcomes: LaunchOptionsOutcomesV1;
  money: NormalizedLaunchMoneySummary;
  platformPlan: unknown;
}): LaunchPlanEnvelopeV1 {
  return launchPlanEnvelopeV1Schema.parse({
    shellVersion: LAUNCH_PLAN_SHELL_VERSION_V1,
    optionsOutcomes: params.optionsOutcomes,
    money: params.money,
    platformPlan: params.platformPlan,
  });
}

export { LAUNCH_PLAN_SHELL_VERSION_V1 };
