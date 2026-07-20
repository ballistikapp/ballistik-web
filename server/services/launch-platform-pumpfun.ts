import "server-only";

/**
 * pump.fun Platform compatibility entry points.
 * Later tickets move planning, execution, classification, and recovery here
 * and will consume LaunchLifecycleContext for progress/logs/cancel instead of
 * writing Launch rows from the job. Until then, execute ignores the context
 * and delegates to the existing launch job.
 */
export async function runPumpfunLaunchJobCompat(launchId: string): Promise<void> {
  const { launchService } = await import("./launch.service");
  await launchService.runLaunchJob(launchId);
}
