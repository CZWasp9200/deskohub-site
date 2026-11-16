import { describe, expect, it } from "bun:test";
import type { authClient } from "@/features/account/auth.client";
import { signOutSucceeded } from "./sign-out-result";

describe("sign-out result", () => {
  it("counts a sign-out without an error as done", () => {
    expect(signOutSucceeded({ error: null })).toBe(true);
  });

  it("treats a rejected sign-out as failed", async () => {
    const result = await Promise.reject(new Error("offline")).catch(
      () => undefined
    );
    expect(signOutSucceeded(result)).toBe(false);
  });

  it("treats a sign-out that returned an error as failed", () => {
    expect(
      signOutSucceeded({ error: { status: 500, message: "Server error" } })
    ).toBe(false);
  });

  it("accepts what the auth client resolves with", () => {
    type SignOutResult = Awaited<ReturnType<typeof authClient.signOut>>;
    const failed = { data: null, error: { status: 500 } } as SignOutResult;
    expect(signOutSucceeded(failed)).toBe(false);
  });
});
