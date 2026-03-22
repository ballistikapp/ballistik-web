type LaunchLogLike = {
  id: string;
  level: "INFO" | "WARN" | "ERROR" | "STEP";
  message: string;
  step: string | null;
  createdAt: Date | string;
};

type LaunchFailureLike = {
  status: string;
  result?: unknown;
};

type FailureRecoveryLike = {
  manualActionRequired?: boolean;
};

export type LaunchActivityItem = LaunchLogLike & {
  isLatest: boolean;
  tone: "default" | "error";
};

function isFailureRecoveryLike(value: unknown): value is FailureRecoveryLike {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildLaunchActivityItems(logs: LaunchLogLike[]) {
  return [...logs]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )
    .map<LaunchActivityItem>((log, index) => ({
      ...log,
      isLatest: index === 0,
      tone: log.level === "ERROR" ? "error" : "default",
    }));
}

export function getLaunchFailureGuidance(launch: LaunchFailureLike) {
  const failureRecovery =
    launch.result &&
    typeof launch.result === "object" &&
    !Array.isArray(launch.result) &&
    "failureRecovery" in launch.result &&
    isFailureRecoveryLike(launch.result.failureRecovery)
      ? launch.result.failureRecovery
      : null;
  const manualActionRequired =
    failureRecovery?.manualActionRequired === true;
  const hasFailureRecoveryMetadata = Boolean(failureRecovery);

  if (launch.status !== "FAILED") {
    return {
      showManageTokensAction: false,
      description: null,
    };
  }

  return {
    showManageTokensAction:
      manualActionRequired || !hasFailureRecoveryMetadata,
    description: manualActionRequired || !hasFailureRecoveryMetadata
      ? "Automatic reclaim could not finish. Go to the My Tokens page to reclaim the remaining SOL."
      : null,
  };
}
