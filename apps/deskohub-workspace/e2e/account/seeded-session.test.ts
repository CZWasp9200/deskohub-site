import { describe, expect, test } from "bun:test";
import type {
  Account,
  RateLimit,
  Session,
  User,
  Verification,
} from "better-auth";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { authOptions } from "@/features/account/backend/auth/auth-options";
import { WorkspaceE2EError } from "../errors";
import { parseHttpsOnlyCookie, redact } from "../runtime";
import {
  resolveWorkspaceE2ESessionSigningSecret,
  signWorkspaceE2ESessionToken,
  workspaceE2ESessionCookieName,
} from "./seeded-session";

const host = "workspace-session.test";
const currentSecret = "synthetic-current-session-signing-secret-0123456789";
const retiredSecret = "synthetic-retired-session-signing-secret-9876543210";

/**
 * The deployed instance's connectionless options with a memory store: the
 * same cookie naming, HTTPS-only prefix, signing secret selection, and
 * database session lookup the protected preview uses.
 */
const makeDeployedShapeAuth = () => {
  const store = {
    account: [] as Account[],
    rateLimit: [] as RateLimit[],
    session: [] as Session[],
    user: [] as User[],
    verification: [] as Verification[],
  };
  const auth = betterAuth({
    ...authOptions,
    baseURL: { allowedHosts: [host], protocol: "https" },
    database: memoryAdapter(store),
    secrets: [
      { value: currentSecret, version: 2 },
      { value: retiredSecret, version: 1 },
    ],
  });
  return { auth, store };
};

const seedStoredSession = (
  store: ReturnType<typeof makeDeployedShapeAuth>["store"],
  token: string
) => {
  const now = new Date();
  store.user.push({
    createdAt: now,
    email: "seeded@workspace-session.test",
    emailVerified: true,
    id: "seeded-user",
    image: null,
    name: "Seeded User",
    updatedAt: now,
  });
  store.session.push({
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    id: "seeded-session",
    ipAddress: "",
    token,
    updatedAt: now,
    userAgent: "",
    userId: "seeded-user",
  });
};

const readSession = (
  auth: ReturnType<typeof makeDeployedShapeAuth>["auth"],
  cookie: string
) =>
  auth.api.getSession({
    headers: new Headers({
      cookie,
      host,
      origin: `https://${host}`,
    }),
  });

describe("workspace e2e seeded sessions", () => {
  test("Better Auth accepts the seeded cookie signed with the current secret", async () => {
    const { auth, store } = makeDeployedShapeAuth();
    const token = "a".repeat(16) + "b".repeat(16);
    seedStoredSession(store, token);
    const secret = resolveWorkspaceE2ESessionSigningSecret({
      WORKSPACE_E2E_BETTER_AUTH_SECRETS: `2:${currentSecret},1:${retiredSecret}`,
    });

    const value = await signWorkspaceE2ESessionToken(token, secret);
    const session = await readSession(
      auth,
      `${workspaceE2ESessionCookieName}=${value}`
    );

    expect(session?.user.id).toBe("seeded-user");
  });

  test("Better Auth rejects a cookie signed with a retired secret or without the secure prefix", async () => {
    const { auth, store } = makeDeployedShapeAuth();
    const token = "c".repeat(32);
    seedStoredSession(store, token);
    const retired = await signWorkspaceE2ESessionToken(token, {
      value: retiredSecret,
    });
    const current = await signWorkspaceE2ESessionToken(token, {
      value: currentSecret,
    });

    expect(
      await readSession(auth, `${workspaceE2ESessionCookieName}=${retired}`)
    ).toBeNull();
    expect(
      await readSession(auth, `better-auth.session_token=${current}`)
    ).toBeNull();
  });

  test("fails closed with provisioning guidance and never echoes the value", () => {
    for (const value of [undefined, "not-versioned", "1:short"]) {
      let failure: unknown;
      try {
        resolveWorkspaceE2ESessionSigningSecret({
          WORKSPACE_E2E_BETTER_AUTH_SECRETS: value,
        });
      } catch (cause) {
        failure = cause;
      }
      expect(failure).toBeInstanceOf(WorkspaceE2EError);
      const message = (failure as WorkspaceE2EError).message;
      expect(message).toContain("Preview-only BETTER_AUTH_SECRETS");
      expect(message).toContain("never the Production value");
      if (value) expect(message).not.toContain(value);
    }
  });

  test("registers every configured secret with the redactor", () => {
    resolveWorkspaceE2ESessionSigningSecret({
      WORKSPACE_E2E_BETTER_AUTH_SECRETS: `2:${currentSecret},1:${retiredSecret}`,
    });

    expect(redact(`current ${currentSecret} retired ${retiredSecret}`)).toBe(
      "current [redacted] retired [redacted]"
    );
  });

  test("cookie input binds one HTTP-only Secure Lax cookie to an HTTPS origin", () => {
    expect(
      parseHttpsOnlyCookie(
        JSON.stringify({
          name: workspaceE2ESessionCookieName,
          url: `https://${host}`,
          value: "signed",
        })
      )
    ).toEqual({
      httpOnly: true,
      name: workspaceE2ESessionCookieName,
      sameSite: "Lax",
      secure: true,
      url: `https://${host}`,
      value: "signed",
    });
    for (const url of [`http://${host}`, `https://${host}/account`]) {
      expect(() =>
        parseHttpsOnlyCookie(
          JSON.stringify({ name: "session", url, value: "signed" })
        )
      ).toThrow();
    }
  });
});
