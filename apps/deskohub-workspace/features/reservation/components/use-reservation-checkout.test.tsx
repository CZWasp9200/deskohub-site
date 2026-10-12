import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { m } from "@/features/i18n";
import type { PreparePayStateInput } from "@/features/reservation/actions/prepare-pay-state.schema";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import {
  workspaceRouterPush as push,
  workspaceUseAction,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type PreparePayStateOptions = {
  readonly onSuccess: (result: {
    readonly data: {
      readonly status: "pricing_changed";
      readonly redirectUrl: string;
    };
  }) => void;
  readonly onTransportError: () => void;
};

const execute = mock((_input: PreparePayStateInput) => undefined);
let preparePayStateOptions: PreparePayStateOptions | undefined;

mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => false }),
}));

mock.module("@/features/reservation/actions/prepare-pay-state", () => ({
  preparePayState: mock(),
}));

const { useReservationCheckout } = await import("./use-reservation-checkout");

const reservationFor = (startHour: number) =>
  normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 1 },
    reservationDate: "2099-07-30",
    startsAt: `2099-07-30T0${startHour}:00:00Z`,
    endsAt: `2099-07-30T0${startHour + 1}:00:00Z`,
    name: "Ada Lovelace",
    email: "ada@example.test",
    phone: "+420777777777",
  });

const renderCheckout = () =>
  renderHook(() => useReservationCheckout({ locale: "en-US" }));

const submittedAttemptIds = () =>
  execute.mock.calls.map(([input]) => input.checkoutAttemptId);

describe("useReservationCheckout", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceUseAction.mockImplementation((_action, options) => {
      preparePayStateOptions = options as PreparePayStateOptions;
      return { execute, isExecuting: false, result: {} };
    });
  });

  afterEach(() => {
    cleanup();
    execute.mockClear();
    push.mockClear();
    workspaceUseAction.mockReset();
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    preparePayStateOptions = undefined;
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("reuses the checkout attempt for a resubmitted order and starts a new one when the order changes", () => {
    const { result } = renderCheckout();
    const start = (startHour: number) =>
      act(() => {
        result.current.startCheckout({
          advertisedPriceToken: "signed-price",
          reservation: reservationFor(startHour),
        });
      });

    start(7);
    start(7);
    start(8);
    start(8);

    const [first, resubmitted, changed, changedResubmitted] =
      submittedAttemptIds();
    expect(first).toBeString();
    expect(resubmitted).toBe(first);
    expect(changed).toBeString();
    expect(changed).not.toBe(first);
    expect(changedResubmitted).toBe(changed);
  });

  test("follows a pricing-changed redirect to the pay page", () => {
    renderCheckout();

    act(() => {
      preparePayStateOptions?.onSuccess({
        data: {
          status: "pricing_changed",
          redirectUrl: "/en-US/checkout/pay?payState=fresh",
        },
      });
    });

    expect(push).toHaveBeenCalledWith("/en-US/checkout/pay?payState=fresh");
  });

  test("reports a transport failure as a submission error", () => {
    const { result } = renderCheckout();

    act(() => {
      preparePayStateOptions?.onTransportError();
    });

    expect(result.current.submissionError).toBe(
      m.reservationErrorMessage({}, { locale: "en-US" })
    );
  });

  describe("with a shared referral code in the reservation URL", () => {
    const submitWithSearch = (search: string) => {
      workspaceUseSearchParams.mockReturnValue(new URLSearchParams(search));
      const { result } = renderCheckout();
      act(() => {
        result.current.startCheckout({
          advertisedPriceToken: "signed-price",
          customer: "account",
          reservation: reservationFor(7),
        });
      });
      expect(execute).toHaveBeenCalledTimes(1);
      return execute.mock.calls[0]?.[0];
    };

    test("forwards the code to checkout preparation", () => {
      expect(
        submitWithSearch("reservationDate=2099-07-30&ref=RFL12345")
      ).toMatchObject({
        advertisedPriceToken: "signed-price",
        customer: "account",
        locale: "en-US",
        referralCode: "RFL12345",
      });
    });

    test.each(["", "ref=", "ref=not%20a%20code"])(
      "omits an absent or malformed code from %p",
      (search) => {
        expect(submitWithSearch(search)).not.toHaveProperty("referralCode");
      }
    );
  });
});
