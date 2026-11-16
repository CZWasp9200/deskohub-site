/**
 * Whether signing out really ended the session. Better Auth reports a failure
 * either by rejecting or by resolving with an `error`; `undefined` stands for
 * the rejected call.
 */
export const signOutSucceeded = (
  result: { readonly error?: unknown } | undefined
): boolean => result !== undefined && !result.error;
