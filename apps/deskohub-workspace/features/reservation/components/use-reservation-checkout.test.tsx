import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PreparePayStateInput } from "@/features/reservation/actions/prepare-pay-state.schema";
import {
  workspaceUseAction,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const execute = mock((_input: PreparePayStateInput) => undefined);

mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => false }),
}));

mock.module("@/features/reservation/actions/prepare-pay-state", () => ({
  preparePayState: mock(),
}));

const { useReservationCheckout } = await import("./use-reservation-checkout");

const details = {
  advertisedPriceToken: "sealed-advertised-price",
  customer: "account" as const,
  reservation: {
    kind: "cowork",
    entryTier: "open-space",
    coffee: false,
    date: "2099-07-30",
    name: "Ada Lovelace",
    email: "ada@example.test",
    phone: "+420777000111",
  } as never,
};

const submitWithSearch = (search: string) => {
  workspaceUseSearchParams.mockReturnValue(new URLSearchParams(search));
  const { result } = renderHook(() =>
    useReservationCheckout({ locale: "en-US" })
  );
  act(() => result.current.startCheckout(details));
  expect(execute).toHaveBeenCalledTimes(1);
  return execute.mock.calls[0]?.[0];
};

describe("useReservationCheckout", () => {
  beforeEach(() => {
    execute.mockClear();
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    } as never);
    window.scrollTo = mock(() => undefined) as never;
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("forwards the shared referral code from the reservation URL", () => {
    const submission = submitWithSearch("entryTier=open-space&ref=RFL12345");

    expect(submission).toMatchObject({
      ...details,
      locale: "en-US",
      referralCode: "RFL12345",
    });
  });

  test.each(["", "ref=", "ref=not%20a%20code"])(
    "omits an absent or malformed referral code from %p",
    (search) => {
      const submission = submitWithSearch(search);

      expect(submission).not.toHaveProperty("referralCode");
    }
  );
});
