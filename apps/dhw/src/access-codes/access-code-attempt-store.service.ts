import {
  AdministrationStandaloneAccessCodeAttemptId,
  type AdministrationStandaloneAccessCodeAttemptIdType,
  AdministrationStandaloneAccessCodeCreateInput,
  type AdministrationStandaloneAccessCodeCreateInputType,
  CliSessionId,
  type CliSessionIdType,
} from "@deskohub/workspace-admin-api";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  type PlatformError,
  Schema,
} from "effect";
import { Digest, SecureRandom } from "effect/crypto";
import { KeyValueStore } from "effect/persistence";
import { DhwConfig } from "../config/dhw-config.service";

const AccessCodeAttemptReservation = Schema.Struct({
  sessionId: CliSessionId,
  request: AdministrationStandaloneAccessCodeCreateInput,
  attemptId: AdministrationStandaloneAccessCodeAttemptId,
  concluded: Schema.Boolean,
});

type AccessCodeAttemptReservation = typeof AccessCodeAttemptReservation.Type;

export interface AccessCodeAttemptIdentity {
  readonly sessionId: CliSessionIdType;
  readonly request: AdministrationStandaloneAccessCodeCreateInputType;
}

const isReservedFor = (
  reservation: AccessCodeAttemptReservation,
  identity: AccessCodeAttemptIdentity
) =>
  reservation.sessionId === identity.sessionId &&
  reservation.request.name === identity.request.name &&
  reservation.request.startsAt === identity.request.startsAt &&
  reservation.request.endsAt === identity.request.endsAt;

interface IAccessCodeAttemptStore {
  readonly reserve: (
    identity: AccessCodeAttemptIdentity
  ) => Effect.Effect<
    AdministrationStandaloneAccessCodeAttemptIdType,
    | KeyValueStore.KeyValueStoreError
    | Schema.SchemaError
    | PlatformError.PlatformError
  >;
  readonly forget: (
    identity: AccessCodeAttemptIdentity,
    attemptId: AdministrationStandaloneAccessCodeAttemptIdType
  ) => Effect.Effect<void>;
}

export class AccessCodeAttemptStore extends Context.Service<
  AccessCodeAttemptStore,
  IAccessCodeAttemptStore
>()("AccessCodeAttemptStore") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const config = yield* DhwConfig;
      const secureRandom = yield* SecureRandom.SecureRandom;
      const digest = yield* Digest.Digest;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const storeLayer = KeyValueStore.layerFileSystem(
        config.stateDirectory
      ).pipe(
        Layer.provide(Layer.succeed(FileSystem.FileSystem, fileSystem)),
        Layer.provide(Layer.succeed(Path.Path, path))
      );

      return yield* makeAccessCodeAttemptStore({
        storeLayer,
        secureRandom,
        digest,
        fileSystem,
        directory: config.stateDirectory,
      });
    })
  );
}

const keyPrefix = "access-code-attempt-";

export interface AccessCodeAttemptLockOptions {
  readonly waitMilliseconds: number;
  readonly retryMilliseconds: number;
}

const defaultLockOptions: AccessCodeAttemptLockOptions = {
  waitMilliseconds: 5_000,
  retryMilliseconds: 50,
};

export const accessCodeAttemptReservationKey = ({
  digest,
  identity,
}: {
  readonly digest: Digest.Digest["Service"];
  readonly identity: AccessCodeAttemptIdentity;
}) => {
  const material = [
    identity.sessionId,
    identity.request.name,
    identity.request.startsAt,
    identity.request.endsAt,
  ].join("\u0000");
  return Effect.map(
    digest.digestHex(Digest.sha256, new TextEncoder().encode(material)),
    (hex) => keyPrefix + hex
  );
};

export const makeAccessCodeAttemptStore = ({
  storeLayer,
  secureRandom,
  digest,
  fileSystem,
  directory,
  lockOptions: partialLockOptions,
}: {
  readonly storeLayer: Layer.Layer<
    KeyValueStore.KeyValueStore,
    PlatformError.PlatformError
  >;
  readonly secureRandom: SecureRandom.SecureRandom["Service"];
  readonly digest: Digest.Digest["Service"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly directory: string;
  readonly lockOptions?: Partial<AccessCodeAttemptLockOptions>;
}) => {
  const lockOptions: AccessCodeAttemptLockOptions = {
    ...defaultLockOptions,
    ...partialLockOptions,
  };
  const serviceLayer = Layer.mergeAll(
    storeLayer,
    Layer.succeed(FileSystem.FileSystem, fileSystem)
  );

  const reservationKey = (identity: AccessCodeAttemptIdentity) =>
    accessCodeAttemptReservationKey({ digest, identity });

  const schemaStoreFor = (keyValueStore: KeyValueStore.KeyValueStore) =>
    KeyValueStore.toSchemaStore(keyValueStore, AccessCodeAttemptReservation);

  const readAt = (key: string) =>
    Effect.flatMap(KeyValueStore.KeyValueStore, (keyValueStore) =>
      schemaStoreFor(keyValueStore).get(key)
    );

  const writeAt = (key: string, reservation: AccessCodeAttemptReservation) =>
    Effect.flatMap(KeyValueStore.KeyValueStore, (keyValueStore) =>
      schemaStoreFor(keyValueStore).set(key, reservation)
    );

  const removeAt = (key: string) =>
    Effect.flatMap(KeyValueStore.KeyValueStore, (keyValueStore) =>
      schemaStoreFor(keyValueStore).remove(key)
    );

  const lockError = (lockPath: string) =>
    new KeyValueStore.KeyValueStoreError({
      method: "lock",
      key: lockPath,
      message: `The access-code attempt reservation is locked by another process and the bounded wait expired. If no other dhw process is running, remove ${lockPath} and run the command again.`,
    });

  const acquireLock = Effect.fn("acquireLock")(function* (lockPath: string) {
    const token = `${process.pid} ${yield* secureRandom.uuidV4()}`;
    const deadline = Date.now() + lockOptions.waitMilliseconds;
    while (true) {
      if (Date.now() >= deadline) {
        return yield* lockError(lockPath);
      }
      const acquired = yield* fileSystem
        .writeFileString(lockPath, token, { flag: "wx" })
        .pipe(
          Effect.as(true),
          Effect.catch((error) =>
            error.reason._tag === "AlreadyExists"
              ? Effect.succeed(false)
              : Effect.fail(error)
          )
        );
      if (acquired) return token;
      yield* Effect.sleep(`${lockOptions.retryMilliseconds} millis`);
    }
  });

  const releaseLock = Effect.fn("releaseLock")(
    function* (lockPath: string, token: string) {
      const current = yield* fileSystem
        .readFileString(lockPath)
        .pipe(Effect.option);
      if (Option.isSome(current) && current.value === token) {
        yield* fileSystem
          .remove(lockPath)
          .pipe(Effect.catch(() => Effect.void));
      }
    },
    (effect) => effect.pipe(Effect.catch(() => Effect.void))
  );

  const withLock = <A, E>(
    key: string,
    critical: Effect.Effect<A, E, KeyValueStore.KeyValueStore>
  ): Effect.Effect<
    A,
    | E
    | KeyValueStore.KeyValueStoreError
    | Schema.SchemaError
    | PlatformError.PlatformError,
    KeyValueStore.KeyValueStore
  > =>
    Effect.acquireUseRelease(
      acquireLock(`${directory}/${key}.lock`),
      (_token) => critical,
      (token) => releaseLock(`${directory}/${key}.lock`, token)
    );

  const reserve = Effect.fn("AccessCodeAttemptStore.reserve")(
    function* (identity: AccessCodeAttemptIdentity) {
      const key = yield* reservationKey(identity);
      return yield* withLock(
        key,
        Effect.gen(function* () {
          const existing = yield* readAt(key);
          const reuse =
            Option.isSome(existing) &&
            !existing.value.concluded &&
            isReservedFor(existing.value, identity);
          const attemptId = reuse
            ? existing.value.attemptId
            : AdministrationStandaloneAccessCodeAttemptId.make(
                yield* secureRandom.uuidV7()
              );
          yield* writeAt(key, {
            sessionId: identity.sessionId,
            request: identity.request,
            attemptId,
            concluded: false,
          });
          return attemptId;
        })
      );
    },
    (effect) => effect.pipe(Effect.provide(serviceLayer))
  );

  const forget = Effect.fn("AccessCodeAttemptStore.forget")(
    function* (
      identity: AccessCodeAttemptIdentity,
      attemptId: AdministrationStandaloneAccessCodeAttemptIdType
    ) {
      const key = yield* reservationKey(identity);
      yield* withLock(
        key,
        Effect.gen(function* () {
          const existing = yield* readAt(key);
          if (
            Option.isNone(existing) ||
            existing.value.concluded ||
            existing.value.attemptId !== attemptId ||
            !isReservedFor(existing.value, identity)
          ) {
            return;
          }
          yield* removeAt(key).pipe(
            Effect.catch(() =>
              writeAt(key, { ...existing.value, concluded: true }).pipe(
                Effect.catch(() => Effect.void)
              )
            )
          );
        })
      );
    },
    (effect) =>
      effect.pipe(
        Effect.provide(serviceLayer),
        Effect.catch(() => Effect.void)
      )
  );

  return Effect.gen(function* () {
    yield* fileSystem
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.catch(() => Effect.void));
    return Effect.succeed({ reserve, forget });
  }).pipe(Effect.flatten);
};
