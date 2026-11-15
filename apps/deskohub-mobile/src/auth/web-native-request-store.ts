import { Option } from "effect";
import {
  type NativeHandoffRequest,
  restoreNativeHandoffRequest,
  serializeNativeHandoffRequest,
} from "./native-handoff-request";

/**
 * The native request kept in this browser's `localStorage`, so the tab the
 * sign-in email opens can still hand the session to the app. Storage that is
 * missing or refuses access reads as no request.
 */
const storageKey = "deskohub.native-handoff-request";

const readStoredRequest = Option.liftThrowable(() =>
  globalThis.localStorage.getItem(storageKey)
);

const writeStoredRequest = Option.liftThrowable((value: string) =>
  globalThis.localStorage.setItem(storageKey, value)
);

const removeStoredRequest = Option.liftThrowable(() =>
  globalThis.localStorage.removeItem(storageKey)
);

/**
 * The request this page load saved while storage refused it. The page still
 * continues it, and still treats itself as opened by the app, though another
 * tab can't.
 */
let unsavedRequest: string | undefined;

export const loadNativeHandoffRequest = (
  now: number
): Option.Option<NativeHandoffRequest> =>
  readStoredRequest().pipe(
    Option.flatMap(Option.fromNullishOr),
    Option.orElse(() => Option.fromNullishOr(unsavedRequest)),
    Option.flatMap((raw) => restoreNativeHandoffRequest(raw, now))
  );

export const saveNativeHandoffRequest = (
  request: NativeHandoffRequest,
  now: number
): void => {
  const serialized = serializeNativeHandoffRequest(request, now);
  unsavedRequest = Option.isNone(writeStoredRequest(serialized))
    ? serialized
    : undefined;
};

export const clearNativeHandoffRequest = (): void => {
  unsavedRequest = undefined;
  removeStoredRequest();
};
