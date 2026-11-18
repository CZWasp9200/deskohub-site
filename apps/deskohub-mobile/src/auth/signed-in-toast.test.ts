import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { expoRouterStandIn } from "../testing/expo-router-stand-in";
import type { AuthSessionState } from "./auth-session-state";
import type { SettledSession } from "./signed-in-toast";

mock.module("expo-router", () => expoRouterStandIn());
const { followSettledSession } = await import("./signed-in-toast");

const restoring: AuthSessionState = { status: "restoring" };
const signedOut: AuthSessionState = { status: "signed-out" };
const signedInAs = (id: string): AuthSessionState => ({
  status: "signed-in",
  user: { id, email: testEmailAddress(id) },
  signedInAt: new Date("2026-11-16T08:00:00.000Z"),
});

/** Whether each step of a session's history is an arrival. */
const arrivals = (history: ReadonlyArray<AuthSessionState>) => {
  let settled: SettledSession = "unknown";
  return history.map((session) => {
    const next = followSettledSession(settled, session);
    settled = next.settled;
    return next.arrived;
  });
};

describe("arriving signed in", () => {
  test("counts a sign-in from the signed-out screen", () => {
    expect(arrivals([restoring, signedOut, signedInAs("ada")])).toEqual([
      false,
      false,
      true,
    ]);
  });

  test("counts a sign-in whose session is read again on the way", () => {
    expect(
      arrivals([restoring, signedOut, restoring, signedInAs("ada")])
    ).toEqual([false, false, false, true]);
  });

  test("ignores a launch that restores a stored session", () => {
    expect(arrivals([restoring, signedInAs("ada")])).toEqual([false, false]);
  });

  test("ignores a session that stays signed in", () => {
    expect(
      arrivals([
        restoring,
        signedInAs("ada"),
        restoring,
        signedInAs("ada"),
        signedInAs("bob"),
      ])
    ).toEqual([false, false, false, false, false]);
  });

  test("counts signing in again after signing out", () => {
    expect(
      arrivals([restoring, signedInAs("ada"), signedOut, signedInAs("ada")])
    ).toEqual([false, false, false, true]);
  });
});
