"use client";

import { Option, Schema } from "effect";
import { useSyncExternalStore } from "react";
import {
  readSessionStorageItem,
  writeSessionStorageItem,
} from "@/shared/browser/session-storage";

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
  const raw = readSessionStorageItem(storageKey);
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
  writeSessionStorageItem(storageKey, JSON.stringify(request));
  notify();
};

/**
 * Drops the pending request without re-rendering its readers, for a tab that
 * is signed in and leaving the page.
 */
export const forgetSignInCodeRequest = () => {
  writeSessionStorageItem(storageKey, null);
};

export const clearSignInCodeRequest = () => {
  writeSessionStorageItem(storageKey, null);
  notify();
};
