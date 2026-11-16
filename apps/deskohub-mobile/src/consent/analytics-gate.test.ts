import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createAnalytics } from "../analytics/analytics";
import {
  type FakeAnalyticsClient,
  makeFakeAnalyticsClient,
} from "../analytics/testing/fake-analytics-client";
import { nativeReturnUri } from "../auth/auth-callback";
import type {
  NativeHandoffAnalyticsAnswer,
  NativeHandoffRequest,
} from "../auth/native-handoff-request";
import { eventually, quietly } from "../testing/eventually";
import {
  type ConsentChoice,
  type ConsentStorage,
  createAnalyticsConsent,
  type StoredConsent,
} from "./analytics-consent";
import {
  type AnalyticsGate,
  carriedAnalyticsDecision,
  consentAnalyticsGate,
  nativeHandoffAnalyticsGate,
} from "./analytics-gate";
import { makeFakeDeviceConsent } from "./testing/fake-device-consent";

// An offset and no fraction: the stored instant must keep this spelling.
const decidedAt = "2026-11-02T10:30:00+01:00";
const granted: NativeHandoffAnalyticsAnswer = { granted: true, decidedAt };
const denied: NativeHandoffAnalyticsAnswer = { granted: false, decidedAt };

const undecided: StoredConsent = { kind: "undecided" };
const siteGrant: StoredConsent = {
  kind: "decided",
  categories: ["necessary", "analytics", "marketing"],
};
const siteDecline: StoredConsent = {
  kind: "decided",
  categories: ["necessary", "preferences"],
};

const request = (
  analytics?: NativeHandoffAnalyticsAnswer
): NativeHandoffRequest => ({
  codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  state: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  returnUri: nativeReturnUri,
  reauthenticate: false,
  ...(analytics === undefined ? {} : { analytics }),
});

/** A device over `stored` and the gate of a page the app opened. */
const openedByApp = (
  stored: StoredConsent,
  analytics?: NativeHandoffAnalyticsAnswer,
  loadLater = false
) => {
  const device = makeFakeDeviceConsent({
    stored,
    accountId: "account-a",
    loadLater,
  });
  const gate = nativeHandoffAnalyticsGate(device.consent, request(analytics));
  return { ...device, gate };
};

const settled = (gate: AnalyticsGate) =>
  Effect.runPromise(eventually(() => gate.status() !== "loading"));

describe("carriedAnalyticsDecision", () => {
  test("takes either answer where the browser holds no choice", () => {
    expect(carriedAnalyticsDecision(undecided, granted)).toEqual({
      analytics: true,
      decidedAt,
    });
    expect(carriedAnalyticsDecision(undecided, denied)).toEqual({
      analytics: false,
      decidedAt,
    });
  });

  test("withdraws a grant", () => {
    expect(carriedAnalyticsDecision(siteGrant, denied)).toEqual({
      analytics: false,
      decidedAt,
    });
  });

  test("never grants over a refusal, nor replaces a grant", () => {
    expect(carriedAnalyticsDecision(siteDecline, granted)).toBeUndefined();
    expect(carriedAnalyticsDecision(siteDecline, denied)).toBeUndefined();
    expect(carriedAnalyticsDecision(siteGrant, granted)).toBeUndefined();
    // A malformed cookie reads as a refusal with no categories.
    expect(
      carriedAnalyticsDecision({ kind: "decided", categories: [] }, granted)
    ).toBeUndefined();
  });
});

describe("page the native app opened with its answer", () => {
  test("stores a carried grant, dated as the app stored it", async () => {
    const { gate, writes, consent } = openedByApp(undecided, granted);
    expect(gate.status()).toBe("loading");
    await settled(gate);
    expect(gate.status()).toBe("granted");
    expect(writes).toEqual([
      { categories: ["necessary", "analytics"], decidedAt, locale: "en-US" },
    ]);
    expect(consent.current()).toMatchObject({ decidedAt });
  });

  test("stores a carried refusal where there was no choice", async () => {
    const { gate, writes } = openedByApp(undecided, denied);
    await settled(gate);
    expect(gate.status()).toBe("denied");
    expect(writes).toEqual([
      { categories: ["necessary"], decidedAt, locale: "en-US" },
    ]);
  });

  test("withdraws the site's grant and keeps its other categories", async () => {
    const { gate, writes } = openedByApp(siteGrant, denied);
    await settled(gate);
    expect(gate.status()).toBe("denied");
    expect(writes).toEqual([
      { categories: ["necessary", "marketing"], decidedAt, locale: "en-US" },
    ]);
  });

  test("keeps the site's refusal over a carried grant", async () => {
    const { gate, writes } = openedByApp(siteDecline, granted);
    await settled(gate);
    expect(gate.status()).toBe("denied");
    expect(writes).toEqual([]);
  });

  test("keeps the site's grant as it is over a carried grant", async () => {
    const { gate, writes } = openedByApp(siteGrant, granted);
    await settled(gate);
    expect(gate.status()).toBe("granted");
    expect(writes).toEqual([]);
  });

  test("waits for the stored answer before taking the app's", async () => {
    const { gate, writes, load } = openedByApp(siteGrant, denied, true);
    expect(gate.status()).toBe("loading");
    expect(writes).toEqual([]);
    load();
    await settled(gate);
    expect(gate.status()).toBe("denied");
    expect(writes).toHaveLength(1);
  });

  test("lets a newer choice win over a grant still being saved", async () => {
    const writes: ConsentChoice[] = [];
    const pending: (() => void)[] = [];
    const storage: ConsentStorage = {
      read: () => undecided,
      write: (choice) => {
        writes.push(choice);
        return new Promise<void>((resolve) => pending.push(resolve));
      },
    };
    const consent = createAnalyticsConsent(storage, () => {}, {
      now: () => new Date("2026-11-15T12:00:00.000Z"),
      locale: () => "en-US",
    });
    const gate = nativeHandoffAnalyticsGate(consent, request(granted));
    consent.deny();
    for (const resolve of pending) resolve();
    await settled(gate);
    expect(gate.status()).toBe("denied");
  });

  test("never asks", () => {
    expect(openedByApp(undecided, granted).gate.asks).toBe(false);
  });
});

describe("page the native app opened without an answer", () => {
  test("keeps analytics off without storing anything", () => {
    for (const stored of [undecided, siteGrant]) {
      const { gate, writes } = openedByApp(stored);
      expect(gate.status()).toBe("undecided");
      expect(gate.asks).toBe(false);
      expect(writes).toEqual([]);
    }
  });

  test("still reports a stored refusal and a pending read", () => {
    expect(openedByApp(siteDecline).gate.status()).toBe("denied");
    const { gate, load } = openedByApp(siteGrant, undefined, true);
    expect(gate.status()).toBe("loading");
    load();
  });
});

describe("consentAnalyticsGate", () => {
  test("follows the stored answer and asks", async () => {
    const { consent } = makeFakeDeviceConsent({
      stored: undecided,
      accountId: "account-a",
    });
    const gate = consentAnalyticsGate(consent);
    expect(gate.asks).toBe(true);
    expect(gate.status()).toBe("undecided");
    const changes: string[] = [];
    gate.subscribe(() => changes.push(gate.status()));
    consent.grant();
    await Effect.runPromise(eventually(() => gate.status() === "granted"));
    expect(changes).toEqual(["granted"]);
  });
});

describe("analytics behind the gate", () => {
  const connect = (gate: AnalyticsGate) => {
    const analytics = createAnalytics();
    const clients: FakeAnalyticsClient[] = [];
    analytics.connect({
      settings: {
        apiKey: "phc_test",
        host: "https://t.example.test",
        environment: "production",
      },
      createClient: (options) => {
        const fake = makeFakeAnalyticsClient(options);
        clients.push(fake);
        return fake.client;
      },
      detectOtherSdk: () => false,
      consent: gate,
      clearStoredState: async () => {},
      warn: () => {},
    });
    analytics.setIdentity({ kind: "anonymous" });
    return clients;
  };

  test("starts no client over the site's grant without the app's answer", async () => {
    const { gate } = openedByApp(siteGrant);
    const clients = connect(gate);
    await Effect.runPromise(quietly);
    expect(clients).toHaveLength(0);
  });

  test("starts a client only once the carried grant is stored", async () => {
    const { gate } = openedByApp(undecided, granted);
    const clients = connect(gate);
    expect(clients).toHaveLength(0);
    await settled(gate);
    await Effect.runPromise(eventually(() => clients.length === 1));
  });

  test("starts a client once a late stored answer takes the carried grant", async () => {
    const { gate, load } = openedByApp(undecided, granted, true);
    const clients = connect(gate);
    await Effect.runPromise(quietly);
    expect(clients).toHaveLength(0);
    load();
    await Effect.runPromise(eventually(() => clients.length === 1));
  });

  test("stops notifying a listener removed before the answer applies", async () => {
    const { gate, load } = openedByApp(undecided, granted, true);
    let calls = 0;
    const unsubscribe = gate.subscribe(() => calls++);
    unsubscribe();
    load();
    await settled(gate);
    expect(calls).toBe(0);
  });

  test("starts no client over the site's grant the app withdrew", async () => {
    const { gate } = openedByApp(siteGrant, denied);
    const clients = connect(gate);
    await settled(gate);
    await Effect.runPromise(quietly);
    expect(clients).toHaveLength(0);
  });
});
