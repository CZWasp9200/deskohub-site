"use client";

import { Option, Schema } from "effect";
import { useEffect, useState } from "react";
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

const readStoredSignInCodeRequest = (): SignInCodeRequest | null => {
  const raw = readSessionStorageItem(storageKey);
  const request =
    raw === null ? null : Option.getOrNull(decodeSignInCodeRequest(raw));
  return request !== null &&
    Date.now() - request.requestedAt < SIGN_IN_CODE_TTL_MS
    ? request
    : null;
};

/**
 * The pending sign-in code request of this tab. It lives in React state and
 * is mirrored to sessionStorage on a best-effort basis, so only restoring the
 * code step after a reload depends on storage. It never enters the URL and
 * reads as absent during server rendering and hydration.
 */
export const useSignInCodeRequest = () => {
  const [request, setRequest] = useState<SignInCodeRequest | null>(null);

  useEffect(() => {
    setRequest(readStoredSignInCodeRequest());
  }, []);

  const updateRequest = (next: SignInCodeRequest | null) => {
    setRequest(next);
    writeSessionStorageItem(
      storageKey,
      next === null ? null : JSON.stringify(next)
    );
  };

  return [request, updateRequest] as const;
};

/**
 * Drops the stored request so a reload no longer restores it, for a tab that
 * is signed in and leaving the page; the code step on screen stays.
 */
export const forgetSignInCodeRequest = () => {
  writeSessionStorageItem(storageKey, null);
};
