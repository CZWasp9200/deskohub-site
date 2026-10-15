"use client";

import { Option, Schema } from "effect";
import { useSyncExternalStore } from "react";

/** A code request stays usable for as long as the code itself (10 minutes). */
export const SIGN_IN_CODE_TTL_MS = 10 * 60 * 1000;
export const SIGN_IN_CODE_LENGTH = 6;

const storageKey = "deskohub:account-sign-in-code";

const signInCodeRequestSchema = Schema.Struct({
  email: Schema.String,
  requestedAt: Schema.Finite,
});
const decodeSignInCodeRequest = Schema.decodeUnknownOption(
  Schema.fromJsonString(signInCodeRequestSchema)
);

export type SignInCodeRequest = typeof signInCodeRequestSchema.Type;

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedRequest: SignInCodeRequest | null = null;

// Storage can be unavailable (privacy modes, quota); it then reads as empty.
const readStoredRequest = Option.liftThrowable(() =>
  globalThis.sessionStorage.getItem(storageKey)
);
const writeStoredRequest = Option.liftThrowable((value: string | null) => {
  if (value === null) globalThis.sessionStorage.removeItem(storageKey);
  else globalThis.sessionStorage.setItem(storageKey, value);
});

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): SignInCodeRequest | null => {
  const raw = Option.getOrNull(readStoredRequest());
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedRequest =
      raw === null ? null : Option.getOrNull(decodeSignInCodeRequest(raw));
  }
  return cachedRequest !== null &&
    Date.now() - cachedRequest.requestedAt < SIGN_IN_CODE_TTL_MS
    ? cachedRequest
    : null;
};

const getServerSnapshot = () => null;

/**
 * The pending sign-in code request of this tab. It lives in sessionStorage so
 * a reload keeps the code step, never in the URL, and reads as absent during
 * server rendering and hydration.
 */
export const useSignInCodeRequest = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

export const saveSignInCodeRequest = (request: SignInCodeRequest) => {
  writeStoredRequest(JSON.stringify(request));
  notify();
};

export const clearSignInCodeRequest = () => {
  writeStoredRequest(null);
  notify();
};
