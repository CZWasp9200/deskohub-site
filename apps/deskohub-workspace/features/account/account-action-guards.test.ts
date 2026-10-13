import { expect, mock, test } from "bun:test";
import { Effect } from "effect";

const areAccountAvatarsEnabled = mock(() => Promise.resolve(true));

mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountAvatarsEnabled,
  areAccountsEnabled: () => Promise.resolve(true),
}));

const { requireAccountAvatarsEnabled } = await import(
  "./account-action-guards"
);

const runGuard = () =>
  Effect.runPromise(requireAccountAvatarsEnabled("en-US").pipe(Effect.result));

test("allows avatar actions while the avatar flag is enabled", async () => {
  areAccountAvatarsEnabled.mockImplementationOnce(() => Promise.resolve(true));

  expect((await runGuard())._tag).toBe("Success");
});

test("rejects avatar actions while the avatar flag is disabled", async () => {
  areAccountAvatarsEnabled.mockImplementationOnce(() => Promise.resolve(false));

  const outcome = await runGuard();

  expect(outcome._tag).toBe("Failure");
  if (outcome._tag === "Failure") {
    expect(outcome.failure).toMatchObject({ _tag: "PublicSafeActionError" });
  }
});

test("fails closed when the avatar flag cannot be read", async () => {
  areAccountAvatarsEnabled.mockImplementationOnce(() =>
    Promise.reject(new Error("synthetic flag outage"))
  );

  const outcome = await runGuard();

  expect(outcome._tag).toBe("Failure");
  if (outcome._tag === "Failure") {
    expect(outcome.failure).toMatchObject({ _tag: "PublicSafeActionError" });
    expect(JSON.stringify(outcome.failure)).not.toContain("synthetic");
  }
});
