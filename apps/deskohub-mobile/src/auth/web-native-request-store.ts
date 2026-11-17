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
 * The request this page load saved while storage refused it. Until it is
 * cleared it is this page's request, over anything storage still holds, so
 * the page still continues it and still treats itself as opened by the app,
 * though another tab can't.
 */
let unsavedRequest: string | undefined;

export const loadNativeHandoffRequest = (
  now: number
): Option.Option<NativeHandoffRequest> =>
  unsavedRequest === undefined
    ? readStoredRequest().pipe(
        Option.flatMap((raw) => restoreNativeHandoffRequest(raw, now))
      )
    : restoreNativeHandoffRequest(unsavedRequest, now);

export const saveNativeHandoffRequest = (
  request: NativeHandoffRequest,
  now: number
): void => {
  const serialized = serializeNativeHandoffRequest(request, now);
  const saved = Option.isSome(writeStoredRequest(serialized));
  unsavedRequest = saved ? undefined : serialized;
  // Another tab mustn't continue an older request this one replaced.
  if (!saved) removeStoredRequest();
};

export const clearNativeHandoffRequest = (): void => {
  unsavedRequest = undefined;
  removeStoredRequest();
};
