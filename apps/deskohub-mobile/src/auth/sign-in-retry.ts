/**
 * The sign-in screen's one-shot request to start a new email sign-in at
 * once, as "Start again" on a failed callback asks. A fresh attempt, not
 * the failed one: the completions registry keeps a failed outcome.
 */
export const signInRetryParams = { start: "email" } as const;

/** Whether the sign-in screen was opened to start an email sign-in. */
export const isSignInRetry = (params: {
  readonly start?: string | ReadonlyArray<string>;
}): boolean => params.start === signInRetryParams.start;
