type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Review screenshots are PR-review artifacts, not test evidence, so a run
 * captures them only when it opts in with WORKSPACE_E2E_REVIEW_SCREENSHOTS=true.
 */
export const isReviewScreenshotCaptureEnabled = (
  environment: RuntimeEnvironment = process.env
): boolean => environment.WORKSPACE_E2E_REVIEW_SCREENSHOTS === "true";
