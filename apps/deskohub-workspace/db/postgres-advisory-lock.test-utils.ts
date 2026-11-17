import { Effect, Layer } from "effect";
import {
  type PostgresAdvisoryLockKey,
  WorkspaceDatabaseAdvisoryLock,
} from "./postgres-advisory-lock";

/**
 * An advisory lock that holds nothing, for unit tests of services that enter
 * lock sections. It records each key a section entered, in order, so a test
 * can assert which lock the work ran under.
 */
export const makeRecordingAdvisoryLock = () => {
  const entered: PostgresAdvisoryLockKey[] = [];
  const layer = Layer.succeed(WorkspaceDatabaseAdvisoryLock, {
    withTransactionPermit: (effect) => effect,
    withLock: (key, effect) =>
      Effect.sync(() => entered.push(key)).pipe(Effect.andThen(effect)),
    withLocks: (keys, effect) =>
      Effect.sync(() => entered.push(...keys)).pipe(Effect.andThen(effect)),
  });
  return { entered, layer };
};
