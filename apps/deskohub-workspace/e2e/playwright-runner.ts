export type WorkspacePlaywrightInvocation = "suite" | "failure-cleanup";

export type WorkspacePlaywrightResult = {
  readonly suiteExitCode: number;
  readonly cleanupExitCode?: number;
  readonly cleanupCouldNotStart?: true;
};

export const runWorkspacePlaywrightWithFailureCleanup = async (
  run: (invocation: WorkspacePlaywrightInvocation) => Promise<number>
): Promise<WorkspacePlaywrightResult> => {
  const suiteExitCode = await run("suite");
  if (suiteExitCode === 0) return { suiteExitCode };

  try {
    const cleanupExitCode = await run("failure-cleanup");
    return { cleanupExitCode, suiteExitCode };
  } catch {
    return { cleanupCouldNotStart: true, suiteExitCode };
  }
};

export type WorkspacePlaywrightSuitesResult = {
  readonly checkout: PromiseSettledResult<WorkspacePlaywrightResult>;
  readonly instantNavigation: PromiseSettledResult<number>;
};

// Settles only after both runs finish, so a launch failure in one cannot let
// the caller exit (and release shared E2E allocations) while the other runs.
export const runWorkspacePlaywrightSuites = async (runs: {
  readonly checkout: (
    invocation: WorkspacePlaywrightInvocation
  ) => Promise<number>;
  readonly instantNavigation: () => Promise<number>;
}): Promise<WorkspacePlaywrightSuitesResult> => {
  const [checkout, instantNavigation] = await Promise.allSettled([
    Promise.try(() => runWorkspacePlaywrightWithFailureCleanup(runs.checkout)),
    Promise.try(runs.instantNavigation),
  ]);
  return { checkout, instantNavigation };
};
