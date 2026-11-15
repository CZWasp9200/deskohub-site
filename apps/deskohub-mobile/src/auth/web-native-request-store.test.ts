import { afterEach, describe, expect, test } from "bun:test";
import { Option } from "effect";
import { nativeReturnUri } from "./auth-callback";
import {
  type NativeHandoffRequest,
  nativeHandoffRequestTtlMs,
} from "./native-handoff-request";
import {
  clearNativeHandoffRequest,
  loadNativeHandoffRequest,
  saveNativeHandoffRequest,
} from "./web-native-request-store";

const request: NativeHandoffRequest = {
  codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  state: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  returnUri: nativeReturnUri,
  reauthenticate: false,
  analytics: { granted: false, decidedAt: "2026-11-02T10:30:00+01:00" },
};
const now = Date.UTC(2026, 10, 15, 12);

const globals = globalThis as { localStorage?: Storage };

/** `localStorage` over a map; `refuse` makes the named calls throw. */
const useStorage = (refuse: ReadonlyArray<"getItem" | "setItem"> = []) => {
  const items = new Map<string, string>();
  const refused = (name: string) => {
    throw new Error(`${name} refused`);
  };
  globals.localStorage = {
    getItem: (key: string) =>
      refuse.includes("getItem")
        ? refused("getItem")
        : (items.get(key) ?? null),
    setItem: (key: string, value: string) => {
      if (refuse.includes("setItem")) refused("setItem");
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  } as Storage;
  return items;
};

afterEach(() => {
  clearNativeHandoffRequest();
  delete globals.localStorage;
});

describe("web native request store", () => {
  test("keeps the request with its analytics answer for other tabs", () => {
    const items = useStorage();
    saveNativeHandoffRequest(request, now);
    expect(items.size).toBe(1);
    expect(loadNativeHandoffRequest(now)).toEqual(Option.some(request));
    expect(loadNativeHandoffRequest(now + nativeHandoffRequestTtlMs)).toEqual(
      Option.none()
    );
  });

  test("keeps the request for this page when storage refuses it", () => {
    useStorage(["setItem"]);
    saveNativeHandoffRequest(request, now);
    expect(loadNativeHandoffRequest(now)).toEqual(Option.some(request));
  });

  test("keeps the request for this page when storage can't be read", () => {
    useStorage(["getItem", "setItem"]);
    saveNativeHandoffRequest(request, now);
    expect(loadNativeHandoffRequest(now)).toEqual(Option.some(request));
  });

  test("forgets the page's copy once storage saved the request or it is cleared", () => {
    useStorage(["setItem"]);
    saveNativeHandoffRequest(request, now);
    clearNativeHandoffRequest();
    expect(loadNativeHandoffRequest(now)).toEqual(Option.none());

    saveNativeHandoffRequest(request, now);
    const items = useStorage();
    saveNativeHandoffRequest(request, now);
    items.clear();
    expect(loadNativeHandoffRequest(now)).toEqual(Option.none());
  });

  test("reads no request without storage", () => {
    expect(loadNativeHandoffRequest(now)).toEqual(Option.none());
  });
});
