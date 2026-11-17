import { Option, Schema } from "effect";
import { isSafeReturnPath } from "./auth-session-state";
import {
  type ReauthenticationPurpose,
  reauthenticationPurposes,
} from "./native-handoff-request";

/**
 * The account a web reauthentication started from and the screen it returns
 * to, kept in `localStorage` because the sign-in email may open in another
 * tab. A reauthentication only starts, and only sends its email, once this is
 * stored, and it outlives the email's link (ten minutes, the server's
 * `betterAuthMagicLinkOptions`), so a link that can still sign in always
 * finds it.
 */
const storageKey = "deskohub.reauthentication";
export const reauthenticationMarkerTtlMs = 30 * 60 * 1000;

// The return path is checked on read, so a bad one loses only itself.
const storedSchema = Schema.fromJsonString(
  Schema.Struct({
    userId: Schema.String,
    expiresAt: Schema.Finite,
    returnPath: Schema.optionalKey(Schema.Unknown),
    purpose: Schema.optionalKey(Schema.Literals(reauthenticationPurposes)),
  })
);
const decodeStored = Schema.decodeUnknownOption(storedSchema);

/**
 * A confirmed reauthentication that named its purpose: the screen that asked
 * for it continues where the customer left off, once, for the same account
 * and purpose, until it expires. It is no proof of a fresh sign-in; the
 * server still decides when the customer repeats the action.
 */
const completedKey = "deskohub.reauthenticated";
export const completedReauthenticationTtlMs = 10 * 60 * 1000;
const completedSchema = Schema.fromJsonString(
  Schema.Struct({
    userId: Schema.String,
    purpose: Schema.Literals(reauthenticationPurposes),
    expiresAt: Schema.Finite,
  })
);
const decodeCompleted = Schema.decodeUnknownOption(completedSchema);

const read = (key: string) =>
  Option.liftThrowable(() => globalThis.localStorage.getItem(key))();
const write = (key: string, value: string) =>
  Option.liftThrowable(() => globalThis.localStorage.setItem(key, value))();
const remove = (key: string) =>
  Option.liftThrowable(() => globalThis.localStorage.removeItem(key))();

export interface StoredReauthentication {
  readonly userId: string;
  /** A router path (without the `/app` base); none when unsafe or absent. */
  readonly returnPath: Option.Option<string>;
  /** Why the screen asked; it continues there once the sign-in is confirmed. */
  readonly purpose: ReauthenticationPurpose | undefined;
}

/** Stores the account; `false` when this browser refuses storage. */
export const saveReauthenticatingUser = (
  {
    userId,
    returnPath,
    purpose,
  }: {
    readonly userId: string;
    readonly returnPath: string;
    readonly purpose?: ReauthenticationPurpose;
  },
  now: number
): boolean =>
  Option.isSome(
    write(
      storageKey,
      JSON.stringify({
        userId,
        expiresAt: now + reauthenticationMarkerTtlMs,
        returnPath,
        purpose,
      })
    )
  );

export const loadReauthentication = (
  now: number
): Option.Option<StoredReauthentication> =>
  read(storageKey).pipe(
    Option.flatMap((raw) => Option.fromNullishOr(raw)),
    Option.flatMap(decodeStored),
    Option.filter(({ expiresAt }) => now < expiresAt),
    Option.map(({ userId, returnPath, purpose }) => ({
      userId,
      returnPath: Option.liftPredicate(returnPath, isSafeReturnPath),
      purpose,
    }))
  );

export const loadReauthenticatingUser = (now: number): Option.Option<string> =>
  Option.map(loadReauthentication(now), ({ userId }) => userId);

/**
 * A sign-in was confirmed as the stored account: the reauthentication is
 * done. One that named its purpose leaves that for the screen it returns to.
 */
export const completeReauthentication = (now: number): void => {
  read(storageKey).pipe(
    Option.flatMap((raw) => Option.fromNullishOr(raw)),
    Option.flatMap(decodeStored),
    Option.filter(({ expiresAt }) => now < expiresAt),
    Option.map(({ userId, purpose }) =>
      purpose === undefined
        ? undefined
        : write(
            completedKey,
            JSON.stringify({
              userId,
              purpose,
              expiresAt: now + completedReauthenticationTtlMs,
            })
          )
    )
  );
  clearReauthenticatingUser();
};

export const clearReauthenticatingUser = (): void => {
  remove(storageKey);
};

/**
 * Whether `userId` just confirmed it's them for `purpose`; the record is
 * used up either way, so it continues one screen once.
 */
export const takeCompletedReauthentication = (
  {
    userId,
    purpose,
  }: { readonly userId: string; readonly purpose: ReauthenticationPurpose },
  now: number
): boolean => {
  const completed = read(completedKey).pipe(
    Option.flatMap((raw) => Option.fromNullishOr(raw)),
    Option.flatMap(decodeCompleted)
  );
  if (Option.isNone(completed)) return false;
  remove(completedKey);
  return (
    completed.value.userId === userId &&
    completed.value.purpose === purpose &&
    now < completed.value.expiresAt
  );
};
