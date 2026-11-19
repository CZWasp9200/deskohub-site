// Under `bun test`, `expect(promise).resolves` and `.rejects` wait in a nested
// event-loop tick that can sleep through a Playwright reply that has already
// arrived, so the matcher settles up to seconds late. A plain `await` settles
// at once. The `no-promise-matchers-in-browser-tests` lint rule bans the
// matchers in test files that import Playwright; these helpers replace the
// rejecting forms.

/**
 * Settles `promise` and returns a function that replays the outcome: it
 * throws the rejection reason, or returns the fulfilled value. Pass it to
 * `toThrow` in place of `expect(promise).rejects.toThrow(...)`; a promise that
 * fulfils makes `toThrow` fail.
 */
export const outcomeOf = <T>(promise: PromiseLike<T>): Promise<() => T> =>
  Promise.resolve(promise).then(
    (value) => () => value,
    (reason) => () => {
      throw reason;
    }
  );

/**
 * Settles `promise` and returns its rejection reason, in place of
 * `expect(promise).rejects` with a value matcher. Throws when the promise
 * fulfils instead.
 */
export const rejectionOf = (promise: PromiseLike<unknown>): Promise<unknown> =>
  Promise.resolve(promise).then(
    (value) => {
      throw new Error(
        `Expected the promise to reject, but it fulfilled with ${Bun.inspect(value)}.`
      );
    },
    (reason) => reason
  );
