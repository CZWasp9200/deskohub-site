import { afterEach, expect, test } from "bun:test";
import { Option } from "effect";
import {
  clearReauthenticatingUser,
  completedReauthenticationTtlMs,
  completeReauthentication,
  loadReauthenticatingUser,
  loadReauthentication,
  reauthenticationMarkerTtlMs,
  saveReauthenticatingUser,
  takeCompletedReauthentication,
} from "./web-reauthentication-store";

// The server's magic links last ten minutes (betterAuthMagicLinkOptions).
const magicLinkLifetimeMs = 10 * 60 * 1000;

const now = Date.UTC(2026, 10, 7, 12);

const useStorage = (storage: Partial<Storage>) =>
  Object.assign(globalThis, { localStorage: storage });

const useMemoryStorage = () => {
  const stored = new Map<string, string>();
  useStorage({
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => void stored.set(key, value),
    removeItem: (key) => void stored.delete(key),
  });
  return stored;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("outlives the sign-in link it guards", () => {
  expect(reauthenticationMarkerTtlMs).toBeGreaterThan(magicLinkLifetimeMs);
});

test("keeps the account until it expires", () => {
  useMemoryStorage();
  expect(
    saveReauthenticatingUser({ userId: "ada", returnPath: "/account" }, now)
  ).toBe(true);
  expect(
    loadReauthenticatingUser(now + reauthenticationMarkerTtlMs - 1)
  ).toEqual(Option.some("ada"));
  expect(loadReauthenticatingUser(now + reauthenticationMarkerTtlMs)).toEqual(
    Option.none()
  );
  clearReauthenticatingUser();
  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
});

test("keeps the screen the reauthentication returns to", () => {
  useMemoryStorage();
  saveReauthenticatingUser(
    { userId: "ada", returnPath: "/account/passkeys" },
    now
  );
  expect(loadReauthentication(now)).toEqual(
    Option.some({
      userId: "ada",
      returnPath: Option.some("/account/passkeys"),
      purpose: undefined,
    })
  );
  expect(loadReauthentication(now + reauthenticationMarkerTtlMs)).toEqual(
    Option.none()
  );
});

test("reads an unsafe or missing return path as none", () => {
  const stored = useMemoryStorage();
  const expiresAt = now + reauthenticationMarkerTtlMs;
  for (const raw of [
    { userId: "ada", expiresAt, returnPath: "//evil.test" },
    { userId: "ada", expiresAt, returnPath: "/sign-in" },
    { userId: "ada", expiresAt, returnPath: 7 },
    { userId: "ada", expiresAt },
  ]) {
    stored.set("deskohub.reauthentication", JSON.stringify(raw));
    expect(loadReauthentication(now)).toEqual(
      Option.some({
        userId: "ada",
        returnPath: Option.none(),
        purpose: undefined,
      })
    );
  }
});

test("reads refused or missing storage as no account", () => {
  useStorage({
    getItem: () => {
      throw new DOMException("denied", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("denied", "SecurityError");
    },
  });
  expect(
    saveReauthenticatingUser({ userId: "ada", returnPath: "/account" }, now)
  ).toBe(false);
  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
  Reflect.deleteProperty(globalThis, "localStorage");
  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
});

test("a confirmed reauthentication for a purpose continues its screen once", () => {
  useMemoryStorage();
  saveReauthenticatingUser(
    { userId: "ada", returnPath: "/account/danger", purpose: "delete-account" },
    now
  );
  completeReauthentication(now);

  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
  const take = (userId: string, at = now) =>
    takeCompletedReauthentication({ userId, purpose: "delete-account" }, at);
  expect(take("ada")).toBe(true);
  expect(take("ada")).toBe(false);
});

test("another account, an expired record or none continues nothing", () => {
  useMemoryStorage();
  const confirm = () => {
    saveReauthenticatingUser(
      {
        userId: "ada",
        returnPath: "/account/danger",
        purpose: "delete-account",
      },
      now
    );
    completeReauthentication(now);
  };
  const take = (userId: string, at = now) =>
    takeCompletedReauthentication({ userId, purpose: "delete-account" }, at);

  confirm();
  expect(take("bob")).toBe(false);
  // A wrong account used it up.
  expect(take("ada")).toBe(false);

  confirm();
  expect(take("ada", now + completedReauthenticationTtlMs)).toBe(false);

  // A reauthentication without a purpose leaves nothing to continue.
  saveReauthenticatingUser({ userId: "ada", returnPath: "/" }, now);
  completeReauthentication(now);
  expect(take("ada")).toBe(false);
});

test("a confirmed reauthentication recorded for another purpose continues nothing", () => {
  const stored = useMemoryStorage();
  saveReauthenticatingUser(
    { userId: "ada", returnPath: "/account/danger", purpose: "delete-account" },
    now
  );
  completeReauthentication(now);
  // The record as another screen's purpose would leave it.
  let rewritten = 0;
  for (const [key, value] of stored) {
    const record: unknown = JSON.parse(value);
    if (typeof record === "object" && record !== null && "purpose" in record) {
      stored.set(key, JSON.stringify({ ...record, purpose: "add-passkey" }));
      rewritten += 1;
    }
  }
  expect(rewritten).toBe(1);
  expect(
    takeCompletedReauthentication(
      { userId: "ada", purpose: "delete-account" },
      now
    )
  ).toBe(false);
});
