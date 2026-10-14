import { expect, mock, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";

const nextServer = await import("next/server");
const connection = mock(() => Promise.resolve());
mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ ...nextServer, connection }));

const referrals = { enabled: true };
mock.module("./referral-feature-flag.server", () => ({
  areReferralsEnabled: async () => referrals.enabled,
}));

const { RememberSharedReferralCode } = await import(
  "./remember-shared-referral-code"
);
const { RememberSharedReferralCodeWhenEnabled } = await import(
  "./remember-shared-referral-code-when-enabled"
);

/** Renders the request-bound gate the Suspense boundary streams in. */
const renderGate = async () => {
  const gate = (
    RememberSharedReferralCodeWhenEnabled() as ReactElement<{
      readonly children: ReactElement;
    }>
  ).props.children;
  return (gate.type as () => Promise<ReactNode>)();
};

test("mounts the shared-code capture while referrals are enabled", async () => {
  referrals.enabled = true;

  const rendered = (await renderGate()) as ReactElement;

  expect(rendered.type).toBe(RememberSharedReferralCode);
  expect(connection).toHaveBeenCalled();
});

test("renders nothing while referrals are off", async () => {
  referrals.enabled = false;

  expect(await renderGate()).toBe(false);
});
