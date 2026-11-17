import type {
  NativeHandoffAnalyticsAnswer,
  NativeHandoffRequest,
} from "../auth/native-handoff-request";
import {
  type AnalyticsConsent,
  type AnalyticsConsentStatus,
  type AnalyticsDecision,
  decisionToTake,
  type StoredConsent,
} from "./analytics-consent";

/**
 * The analytics consent this page's analytics follows, and whether the
 * consent prompt may ask for an answer.
 */
export interface AnalyticsGate {
  readonly status: () => AnalyticsConsentStatus;
  /** Calls the listener when the status may have changed. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly asks: boolean;
}

/** The stored consent itself, as everywhere but a page the app opened. */
export const consentAnalyticsGate = (
  consent: AnalyticsConsent
): AnalyticsGate => ({
  status: consent.status,
  subscribe: (listener) => consent.subscribe(() => listener()),
  asks: true,
});

/**
 * The part of the app's carried answer this browser's stored answer takes:
 * all of it where there was no choice, else what any decision made elsewhere
 * may change (`decisionToTake`): a withdrawal over a grant, never a grant
 * over a refusal.
 */
export const carriedAnalyticsDecision = (
  stored: StoredConsent,
  { granted, decidedAt }: NativeHandoffAnalyticsAnswer
): AnalyticsDecision | undefined => {
  const decision = { analytics: granted, decidedAt };
  return stored.kind === "undecided"
    ? decision
    : decisionToTake(stored, decision);
};

/**
 * Without the app's answer, analytics stays off on the page the app opened,
 * whatever the browser holds: no answer is consent, and the site's grant
 * isn't the app's. A stored refusal still reads as one, so analytics clears
 * what an earlier client left; nothing is ever stored.
 */
const unansweredStatus = (
  consent: AnalyticsConsent
): AnalyticsConsentStatus => {
  const status = consent.status();
  return status === "loading" || status === "denied" ? status : "undecided";
};

/**
 * Takes the app's carried answer into this browser's stored answer once it
 * has loaded, and reports `loading` until that is applied, so analytics
 * never acts on the answer it replaces.
 */
const answeredAnalyticsGate = (
  consent: AnalyticsConsent,
  answer: NativeHandoffAnalyticsAnswer
): AnalyticsGate => {
  let applying = true;
  const listeners = new Set<() => void>();
  const applied = () => {
    applying = false;
    for (const listener of listeners) listener();
  };
  const apply = (stored: StoredConsent) => {
    const decision = carriedAnalyticsDecision(stored, answer);
    if (decision === undefined) applied();
    else void consent.applyAppDecision(decision).then(applied);
  };
  const loaded = consent.current();
  if (loaded !== undefined) {
    apply(loaded);
  } else {
    const stopWaiting = consent.subscribe(() => {
      const stored = consent.current();
      if (stored === undefined) return;
      stopWaiting();
      apply(stored);
    });
  }
  return {
    // Read after the apply, so a newer choice wins over the one it saved.
    status: () => (applying ? "loading" : consent.status()),
    subscribe: (listener) => {
      listeners.add(listener);
      const unsubscribe = consent.subscribe(() => listener());
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    asks: false,
  };
};

/**
 * The page the native app opened for its sign-in: it never asks for
 * consent, takes the app's carried answer, and without one keeps analytics
 * off.
 */
export const nativeHandoffAnalyticsGate = (
  consent: AnalyticsConsent,
  request: NativeHandoffRequest
): AnalyticsGate =>
  request.analytics === undefined
    ? {
        status: () => unansweredStatus(consent),
        subscribe: (listener) => consent.subscribe(() => listener()),
        asks: false,
      }
    : answeredAnalyticsGate(consent, request.analytics);
