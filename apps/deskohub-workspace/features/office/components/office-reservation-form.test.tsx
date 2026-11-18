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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Effect, Layer, Schema } from "effect";
import type { ComponentProps } from "react";
import { makeOfficePayRouteFixture } from "@/features/checkout/backend/checkout/office-pay-route.test-utils";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { discountIdSchema } from "@/features/discounts";
import { m } from "@/features/i18n";
import { recordReservationPagePreloads } from "@/features/reservation/backend/reservation-page-preloads.service.mock";
import { mockReservationCheckoutStep } from "@/features/reservation/components/reservation-checkout-step.test-utils";
import { mockCheckoutEmailVerification } from "@/features/reservation/components/use-checkout-email-verification.test-utils";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import { officeReservationDefaultValues } from "@/features/reservation/office-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { getOfficeAvailabilityQuery } from "@/features/reservation/workspace-availability";
import { formatMoney, moneyWithValue } from "@/shared/money/money";
import {
  workspaceUseAction,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { plainDateStringSchema } from "@/shared/utils/temporal";

// React DOM detects input events when it loads, so the DOM must exist before
// it is imported for typed text to reach the form.
registerWorkspaceComponentTestEnv();

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);

const executeAsync = mock(() => Promise.resolve({}));
const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);
const originalFetch = globalThis.fetch;

mock.module("@/features/cookie-consent", () => ({
  useVisitorConsent: () => false,
  visitorConsent: { accepts: () => false },
}));

mock.module("@/features/reservation/actions/get-advertised-price", () => ({
  getAdvertisedPrices: () => Promise.resolve({ data: [] }),
}));

const verifyEmail = mockCheckoutEmailVerification();
const checkoutStep = mockReservationCheckoutStep();
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

const { OfficeReservationForm, OfficeReservationFormFallback } = await import(
  "./office-reservation-form"
);

const officeAvailabilityResponse = ({
  from,
  to,
  unavailableDates = [],
}: {
  readonly from: string;
  readonly to: string;
  readonly unavailableDates?: readonly string[];
}) =>
  new Response(
    JSON.stringify({
      from,
      to,
      unavailableDates,
      reservedDeskWorkstationRequiredDates: [],
      unavailableCoworkTiers: [],
      meetingRoomUnavailable: false,
      officeUnavailable: false,
      unavailableMonitorOptions: [],
      notices: [],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

const renderOfficeForm = (
  props: Partial<ComponentProps<typeof OfficeReservationForm>> &
    Pick<ComponentProps<typeof OfficeReservationForm>, "today">,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  })
) =>
  render(
    <QueryClientProvider client={queryClient}>
      <OfficeReservationForm
        checkoutCustomer={{ status: "signed-out" }}
        seatCapacity={3}
        initialValues={officeReservationDefaultValues}
        locale="en-US"
        {...props}
      />
    </QueryClientProvider>
  );

describe("OfficeReservationForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    checkoutStep.initial = "selection";
    verifyEmail.mockClear();
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    workspaceUseAction.mockReturnValue({
      executeAsync,
      isExecuting: false,
      result: {},
    });
  });

  afterEach(async () => {
    cleanup();
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    executeAsync.mockClear();
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("loads the month calendar without seat or interval filters and bounds the stay before an unavailable date", async () => {
    const today = decodePlainDate("2026-08-10");
    const requests: URL[] = [];
    globalThis.fetch = mock((request: RequestInfo | URL) => {
      const url = new URL(String(request), "https://workspace.example.test");
      requests.push(url);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            date: undefined,
            from: "2026-08-10",
            to: "2026-09-10",
            unavailableDates: ["2026-08-12"],
            reservedDeskWorkstationRequiredDates: [],
            unavailableCoworkTiers: [],
            meetingRoomUnavailable: false,
            officeUnavailable: false,
            unavailableMonitorOptions: [],
            notices: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }) as typeof fetch;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          checkoutCustomer={{ status: "signed-out" }}
          seatCapacity={3}
          initialValues={{
            ...officeReservationDefaultValues,
            startsOn: today,
            dayCount: 2,
          }}
          locale="en-US"
          today={today}
        />
      </QueryClientProvider>
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      kind: "office",
      from: "2026-08-10",
      to: "2026-09-10",
    });

    await waitFor(() => {
      expect(
        view.getByRole<HTMLInputElement>("spinbutton", {
          name: "Number of days",
        }).max
      ).toBe("2");
    });
    expect(view.queryByText(/days from this start date/i)).toBeNull();
  });

  test("bounds the stay from page-loaded availability without a client request", () => {
    const today = decodePlainDate("2026-08-10");
    const fetchCalls = mock((_request: RequestInfo | URL) =>
      Promise.resolve(
        officeAvailabilityResponse({ from: today, to: "2026-09-10" })
      )
    );
    globalThis.fetch = fetchCalls as typeof fetch;
    const query = getOfficeAvailabilityQuery(today);

    const view = renderOfficeForm({
      initialAvailability: [
        {
          query,
          availability: {
            from: query.from,
            to: query.to,
            unavailableDates: ["2026-08-12"],
            reservedDeskWorkstationRequiredDates: [],
            unavailableCoworkTiers: [],
            meetingRoomUnavailable: false,
            officeUnavailable: false,
            unavailableMonitorOptions: [],
            notices: [],
          },
          loadedAt: Date.now(),
        },
      ],
      initialValues: {
        ...officeReservationDefaultValues,
        startsOn: today,
        dayCount: 2,
      },
      today,
    });

    expect(
      view.getByRole<HTMLInputElement>("spinbutton", {
        name: "Number of days",
      }).max
    ).toBe("2");
    expect(fetchCalls).not.toHaveBeenCalled();
  });

  const officeAdvertisedPrices = (
    startsOn: ReturnType<typeof decodePlainDate>,
    endsOn = startsOn
  ) =>
    [1, 2, 3].map((seats) => {
      const request = getOfficeAdvertisedPriceRequest({
        endsOn,
        locale: "en-US",
        seats,
        startsOn,
      });
      const quote = Effect.runSync(
        buildOfficeReservationQuote(request.reservation.details)
      );

      return {
        request,
        advertisedPrice: {
          advertisedPriceToken: `office-${seats}`,
          kind: "office" as const,
          quote,
          summary: getOfficeCheckoutSummary(quote),
        },
      };
    });
  const normalizeSpaces = (text: string | null | undefined) =>
    text?.replaceAll(/[\u00a0\u202f]/g, " ");

  test("edits and resubmits the signed three-seat, two-day Pay hold", async () => {
    checkoutStep.initial = "contact";
    const today = getCurrentWorkspaceDate();
    const startsOn = decodePlainDate(today.toString());
    const endsOn = decodePlainDate(today.add({ days: 1 }).toString());
    const held = makeOfficePayRouteFixture({
      seatOnly: true,
      startsOn,
      endsOn,
    });
    const checkoutView = await import(
      "@/features/checkout/backend/checkout/pay-state-checkout-view"
    );
    let visitorServices = held.services;
    mock.module(
      "@/features/checkout/backend/checkout/pay-state-checkout-view",
      () => ({
        ...checkoutView,
        checkoutOfficeSelectionForVisitorServices: Layer.unwrap(
          Effect.sync(() => visitorServices)
        ),
      })
    );
    const { loadRestoredReservation } = await import(
      "@/features/reservation/components/create-reservation-page.server"
    );
    const { officeReservationPage } = await import("./office-reservation-page");
    const token = await held.seal("en-US");
    const restored = await Effect.runPromise(
      loadRestoredReservation(token, "en-US", "office")
    );
    if (!restored) throw new Error("Expected a restored reservation");
    const prices = officeAdvertisedPrices(startsOn, endsOn);
    const content = await Effect.runPromise(
      officeReservationPage
        .loadContent({
          checkoutAccount: {
            status: "linked",
            customer: {
              contact: {
                email: held.reservation.email,
                name: held.reservation.name,
                phone: held.reservation.phone,
              },
              hasMarketingConsent: false,
            },
          },
          pageData: 3,
          locale: "en-US",
          restoredReservation: restored,
          searchParams: { payState: token, seats: "1" },
        })
        .pipe(
          Effect.provide(
            recordReservationPagePreloads({
              advertisedPrices: () => Effect.succeed(prices),
            }).layer
          )
        )
    );
    if (content.kind !== "form") throw new Error("Expected the office form");
    expect(content.form.replacementToken === token).toBe(true);
    globalThis.fetch = Object.assign(
      mock(async () =>
        officeAvailabilityResponse({
          from: startsOn,
          to: today.add({ days: 30 }).toString(),
        })
      ),
      { preconnect: originalFetch.preconnect }
    );
    const view = renderOfficeForm({
      ...content.form,
      seatCapacity: content.form.pageData,
    });
    const total = formatMoney(
      prices[2]!.advertisedPrice.quote.payment.expectedPrice,
      "en-US"
    );
    expect(normalizeSpaces(view.container.textContent)).toContain(
      normalizeSpaces(total)
    );
    const submit = view.container.querySelector<HTMLButtonElement>(
      "#reservation-submit"
    );
    if (!submit) throw new Error("Expected the checkout button");
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(executeAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          advertisedPriceToken: "office-3",
          checkoutSessionId: "office-session",
          reservation: expect.objectContaining({
            kind: "office",
            seats: 3,
            startsOn,
            endsOn,
          }),
        })
      )
    );
    expect(executeAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({
        people: expect.anything(),
      })
    );

    held.signInAsAnotherAccount();
    expect(
      await Effect.runPromise(loadRestoredReservation(token, "en-US", "office"))
    ).toBeUndefined();

    const unreadable = makeOfficePayRouteFixture({
      unavailablePeople: true,
      startsOn,
      endsOn,
    });
    visitorServices = unreadable.services;
    const unreadableToken = await unreadable.seal("en-US");
    expect(
      await Effect.runPromise(
        loadRestoredReservation(unreadableToken, "en-US", "office")
      )
    ).toBeUndefined();
  });

  test("prices the office and each person beside the people list", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const initialAdvertisedPrices = officeAdvertisedPrices(
      startsOn,
      decodePlainDate("2026-08-12")
    );
    const [oneSeat] = initialAdvertisedPrices;
    const item = oneSeat?.advertisedPrice.quote.items[0];
    if (!(oneSeat && item)) throw new Error("Expected a one-seat quote");
    const view = renderOfficeForm({
      initialAdvertisedPrices,
      initialValues: {
        ...officeReservationDefaultValues,
        startsOn,
        dayCount: 3,
      },
      today: startsOn,
    });

    const dateRange = view.getByRole("group", { name: "Reservation dates" });
    const price = view.container.querySelector("[data-office-price]");
    if (!price) throw new Error("Expected the office price");
    const priceText = normalizeSpaces(price.textContent);
    expect(priceText).toContain(
      m.reservationOfficeBasePriceLabel({ dayCount: 3 }, { locale: "en-US" })
    );
    expect(priceText).toContain(
      normalizeSpaces(formatMoney(item.accessAmount, "en-US"))
    );
    expect(priceText).toContain(
      normalizeSpaces(
        m.officePeoplePriceSeatLine(
          { count: 1, seatPrice: formatMoney(item.seatAmount, "en-US") },
          { locale: "en-US" }
        )
      )
    );
    expect(priceText).toContain(
      normalizeSpaces(
        formatMoney(
          oneSeat.advertisedPrice.quote.payment.expectedPrice,
          "en-US"
        )
      )
    );
    expect(
      dateRange.compareDocumentPosition(price) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
  });

  test("does not render office prices before an advertised quote is available", () => {
    const date = decodePlainDate("2026-08-10");
    const view = renderOfficeForm({
      initialValues: { ...officeReservationDefaultValues, startsOn: date },
      today: date,
    });

    expect(view.queryByText(/CZK/)).toBeNull();
  });

  test("starts with the contact and adds people by email up to the office capacity", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const initialAdvertisedPrices = officeAdvertisedPrices(startsOn);
    const view = renderOfficeForm({
      initialAdvertisedPrices,
      initialValues: { ...officeReservationDefaultValues, startsOn },
      today: startsOn,
    });
    const people = () =>
      view.getByRole("list", {
        name: m.officePeopleLabel({}, { locale: "en-US" }),
      });
    const emailInput = () =>
      view.getByRole("textbox", {
        name: m.officePeopleEmailLabel({}, { locale: "en-US" }),
      });
    const add = (email: string) => {
      fireEvent.change(emailInput(), { target: { value: email } });
      fireEvent.click(
        view.getByRole("button", {
          name: m.officePeopleAdd({}, { locale: "en-US" }),
        })
      );
    };

    expect(people().querySelectorAll("li")).toHaveLength(1);
    expect(people().textContent).toContain(
      m.officePeopleContactEmailLater({}, { locale: "en-US" })
    );

    add("jana.novak@");
    expect(view.getByRole("alert").textContent).toBe(
      m.officePeopleInvalidEmail({}, { locale: "en-US" })
    );
    expect(people().querySelectorAll("li")).toHaveLength(1);

    add(" Jana.Novak@Example.org ");
    expect(people().textContent).toContain("jana.novak@example.org");
    add("jana.novak@example.org");
    expect(view.getByRole("alert").textContent).toBe(
      m.officePeopleDuplicateEmail({}, { locale: "en-US" })
    );

    add("petr.svoboda@example.org");
    expect(people().querySelectorAll("li")).toHaveLength(3);
    expect(
      view.container.querySelector("[data-office-people-count]")?.textContent
    ).toBe(m.officePeopleCount({ count: 3, maximum: 3 }, { locale: "en-US" }));
    expect(view.container.querySelector("[data-office-people-full]")).not.toBe(
      null
    );
    expect(
      view.queryByRole("textbox", {
        name: m.officePeopleEmailLabel({}, { locale: "en-US" }),
      })
    ).toBeNull();
    const threeSeats = initialAdvertisedPrices[2];
    if (!threeSeats) throw new Error("Expected a three-seat quote");
    expect(
      normalizeSpaces(
        view.container.querySelector("[data-office-price]")?.textContent
      )
    ).toContain(
      normalizeSpaces(
        formatMoney(
          threeSeats.advertisedPrice.quote.payment.expectedPrice,
          "en-US"
        )
      )
    );

    fireEvent.click(
      view.getByRole("button", {
        name: m.officePeopleRemove(
          { email: "jana.novak@example.org" },
          { locale: "en-US" }
        ),
      })
    );
    expect(people().querySelectorAll("li")).toHaveLength(2);
    expect(emailInput()).toBeDefined();
  });

  test("lets the contact step out and back in while someone is still coming", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const view = renderOfficeForm({
      initialAdvertisedPrices: officeAdvertisedPrices(startsOn),
      initialValues: { ...officeReservationDefaultValues, startsOn },
      today: startsOn,
    });
    const removeYourself = () =>
      view.getByRole("button", {
        name: m.officePeopleRemoveYourself({}, { locale: "en-US" }),
      }) as HTMLButtonElement;

    expect(removeYourself().disabled).toBe(true);
    fireEvent.change(
      view.getByRole("textbox", {
        name: m.officePeopleEmailLabel({}, { locale: "en-US" }),
      }),
      { target: { value: "jana.novak@example.org" } }
    );
    fireEvent.click(
      view.getByRole("button", {
        name: m.officePeopleAdd({}, { locale: "en-US" }),
      })
    );
    fireEvent.click(removeYourself());

    const remaining = view.getByRole("button", {
      name: m.officePeopleRemove(
        { email: "jana.novak@example.org" },
        { locale: "en-US" }
      ),
    }) as HTMLButtonElement;
    expect(remaining.disabled).toBe(true);
    fireEvent.click(
      view.getByRole("button", {
        name: m.officePeopleAddYourself({}, { locale: "en-US" }),
      })
    );
    expect(removeYourself().disabled).toBe(false);
  });

  test("uses Enter to replace the only attendee and keeps focus when switching back", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const view = renderOfficeForm({
      initialAdvertisedPrices: officeAdvertisedPrices(startsOn),
      initialValues: { ...officeReservationDefaultValues, startsOn },
      seatCapacity: 1,
      today: startsOn,
    });
    const list = view.getByRole("list", {
      name: m.officePeopleLabel({}, { locale: "en-US" }),
    });
    const field = view.getByRole("textbox", {
      name: m.officePeopleEmailLabel({}, { locale: "en-US" }),
    });
    const count = () =>
      view.container.querySelector("[data-office-people-count]")?.textContent;
    const oneSeat = m.officePeopleCount(
      { count: 1, maximum: 1 },
      { locale: "en-US" }
    );
    expect(count()).toBe(oneSeat);
    fireEvent.change(field, { target: { value: "incorrect@" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(count()).toBe(oneSeat);
    expect(list.textContent).toContain(
      m.officePeopleYou({}, { locale: "en-US" })
    );

    field.focus();
    fireEvent.change(field, { target: { value: "guest@example.org" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(list.textContent).toContain("guest@example.org");
    expect(list.querySelectorAll("li")).toHaveLength(1);
    expect(count()).toBe(oneSeat);
    expect(document.activeElement).toBe(field);

    const switchToYou = view.getByRole("button", {
      name: m.officePeopleSwitchToYourself({}, { locale: "en-US" }),
    });
    switchToYou.focus();
    fireEvent.click(switchToYou);
    expect(document.activeElement).toBe(field);
    expect(list.textContent).not.toContain("guest@example.org");
    expect(list.textContent).toContain(
      m.officePeopleYou({}, { locale: "en-US" })
    );
    expect(count()).toBe(oneSeat);
  });

  test("applies the verified office draft before submitting the advertised two-seat checkout", async () => {
    checkoutStep.initial = "contact";
    const today = getCurrentWorkspaceDate();
    const startsOn = decodePlainDate(today.toString());
    const contact = {
      name: "Alex Sample",
      email: "alex@deskohub.test",
      phone: "+420777777777",
    };
    const people = {
      contactAttends: false,
      invitees: ["guest-one@example.org", "guest-two@example.org"],
    };
    const officeSelection = { kind: "people", people } as const;
    globalThis.fetch = Object.assign(
      mock(async () =>
        officeAvailabilityResponse({
          from: startsOn,
          to: today.add({ days: 30 }).toString(),
        })
      ),
      { preconnect: originalFetch.preconnect }
    );
    const props = {
      initialValues: {
        ...officeReservationDefaultValues,
        startsOn,
        ...contact,
      },
      initialAdvertisedPrices: officeAdvertisedPrices(startsOn),
      today: startsOn,
    };
    const signedOut = renderOfficeForm({
      ...props,
      initialValues: { ...props.initialValues, people },
    });
    const submit = signedOut.container.querySelector<HTMLButtonElement>(
      "#reservation-submit"
    );
    if (!submit) throw new Error("Missing checkout button");
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(verifyEmail).toHaveBeenCalledWith(
        expect.objectContaining({ email: contact.email, officeSelection })
      )
    );
    expect(executeAsync).not.toHaveBeenCalled();
    signedOut.unmount();

    renderOfficeForm({
      ...props,
      checkoutCustomer: {
        status: "profile-missing",
        email: contact.email,
        continuesCheckout: true,
      },
      checkoutOfficeSelection: officeSelection,
    });
    await waitFor(() =>
      expect(executeAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          advertisedPriceToken: "office-2",
          people,
          reservation: expect.objectContaining({ kind: "office", seats: 2 }),
        })
      )
    );
  });

  test("shows the signed-in contact and refuses their own email as an invitee", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const contactEmail = "alex.sample@deskohub.test";
    const view = renderOfficeForm({
      initialValues: {
        ...officeReservationDefaultValues,
        startsOn,
        name: "Alex Sample",
        email: contactEmail,
      },
      today: startsOn,
    });

    const people = view.getByRole("list", {
      name: m.officePeopleLabel({}, { locale: "en-US" }),
    });
    expect(people.textContent).toContain("Alex Sample");
    expect(people.textContent).toContain(contactEmail);

    fireEvent.change(
      view.getByRole("textbox", {
        name: m.officePeopleEmailLabel({}, { locale: "en-US" }),
      }),
      { target: { value: contactEmail.toUpperCase() } }
    );
    fireEvent.click(
      view.getByRole("button", {
        name: m.officePeopleAdd({}, { locale: "en-US" }),
      })
    );
    expect(view.getByRole("alert").textContent).toBe(
      m.officePeopleContactEmail({}, { locale: "en-US" })
    );
  });

  test("marks an invitee whose email turns out to be the contact's", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const contactEmail = "alex.sample@deskohub.test";
    const view = renderOfficeForm({
      initialValues: {
        ...officeReservationDefaultValues,
        startsOn,
        email: contactEmail,
        // Edit from Pay restores the people of the held reservation.
        people: { contactAttends: false, invitees: [contactEmail] },
      } as ComponentProps<typeof OfficeReservationForm>["initialValues"],
      today: startsOn,
    });

    expect(
      view.container.querySelector("[data-office-person-error]")?.textContent
    ).toBe(m.officePeopleContactEmail({}, { locale: "en-US" }));
  });

  test("presents a quoted office sale around the form", () => {
    const startsOn = decodePlainDate("2026-08-10");
    const initialAdvertisedPrices = [1, 2, 3].map((seats) => {
      const request = getOfficeAdvertisedPriceRequest({
        endsOn: startsOn,
        locale: "en-US",
        seats,
        startsOn,
      });
      const undiscountedQuote = Effect.runSync(
        buildOfficeReservationQuote(request.reservation.details)
      );
      const amount = undiscountedQuote.payment.expectedPrice;
      const discountedAmount = moneyWithValue(amount.value / 2, amount);
      const quote = Effect.runSync(
        buildOfficeReservationQuote(request.reservation.details, {
          discountQuote: {
            product: { kind: "office", seats, dayCount: 1 },
            discountableSubtotal: amount,
            discounts: [
              {
                discount: {
                  id: Schema.decodeUnknownSync(discountIdSchema)("office-sale"),
                  label: "Office sale",
                  adjustment: { kind: "percentage", basisPoints: 5000 },
                },
                subtotalBefore: amount,
                amount: discountedAmount,
                subtotalAfter: discountedAmount,
              },
            ],
            totalDiscount: discountedAmount,
            discountedSubtotal: discountedAmount,
          },
        })
      );

      return {
        request,
        advertisedPrice: {
          advertisedPriceToken: `office-sale-${seats}`,
          kind: "office" as const,
          quote,
          summary: getOfficeCheckoutSummary(quote),
        },
      };
    });
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          checkoutCustomer={{ status: "signed-out" }}
          seatCapacity={3}
          initialAdvertisedPrices={initialAdvertisedPrices}
          initialValues={{
            ...officeReservationDefaultValues,
            startsOn,
          }}
          locale="en-US"
          today={startsOn}
        />
      </QueryClientProvider>
    );

    const saleCard = view.container.querySelector(
      '[data-reservation-sale="active"]'
    );
    expect(
      saleCard?.querySelectorAll(
        '[data-reservation-sale-discount="office-sale"]'
      )
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll("[data-reservation-sale-banner]")
    ).toHaveLength(1);
    expect(
      view.getByRole("button", { name: /discount.*private office/i })
    ).toBeDefined();
  });

  test("holds the people list's place while the form loads", () => {
    const fallback = render(<OfficeReservationFormFallback locale="en-US" />);

    expect(
      fallback.container.querySelector("[data-office-people-fallback]")
    ).not.toBeNull();
  });

  test("validates an empty start date when its calendar closes", async () => {
    const today = decodePlainDate("2026-08-10");
    globalThis.fetch = mock(() =>
      Promise.resolve(
        officeAvailabilityResponse({ from: "2026-08-10", to: "2026-09-10" })
      )
    ) as typeof fetch;
    const view = renderOfficeForm({
      initialValues: officeReservationDefaultValues,
      today,
    });
    const startDate = view.getByRole("combobox", {
      name: /^Office reservation start date/,
    });
    const calendarButton = view.getByRole("button", {
      name: /^Office reservation start date/,
    });
    expect(startDate.getAttribute("aria-invalid")).toBe("false");

    await act(async () => fireEvent.click(calendarButton));
    await act(async () => fireEvent.click(calendarButton));
    await act(async () => {});

    expect(startDate.getAttribute("aria-invalid")).toBe("true");
    expect(executeAsync).not.toHaveBeenCalled();
  });

  test("keeps a typed unavailable start date out of the form", async () => {
    const today = decodePlainDate("2026-08-10");
    globalThis.fetch = mock(() =>
      Promise.resolve(
        officeAvailabilityResponse({
          from: "2026-08-10",
          to: "2026-09-10",
          unavailableDates: ["2026-08-12"],
        })
      )
    );

    const view = renderOfficeForm({
      initialValues: { ...officeReservationDefaultValues, startsOn: today },
      today,
    });
    const startDate = view.getByRole<HTMLInputElement>("combobox", {
      name: /^Office reservation start date/,
    });
    const startsOn = () =>
      view.container.querySelector<HTMLInputElement>('input[name="startsOn"]')
        ?.value;
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(startDate.value).toBe("8/10/2026");

    await act(async () => {
      fireEvent.change(startDate, { target: { value: "8/12/2026" } });
      fireEvent.focusOut(startDate);
    });

    expect(startsOn()).toBe("");
    expect(startDate.value).toBe("8/12/2026");
    expect(startDate.getAttribute("aria-invalid")).toBe("true");
    expect(
      (startDate.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
    ).toContain(
      m.dateInputUnavailable({ date: "August 12, 2026" }, { locale: "en-US" })
    );

    const form = startDate.closest("form");
    if (!form) throw new Error("the start date is outside the form");
    await act(async () => fireEvent.submit(form));
    await act(async () => {});

    expect(executeAsync).not.toHaveBeenCalled();
    expect(startsOn()).toBe("");

    await act(async () => {
      fireEvent.change(startDate, { target: { value: "2026-08-11" } });
      fireEvent.focusOut(startDate);
    });
    expect(startsOn()).toBe("2026-08-11");
    expect(startDate.value).toBe("8/11/2026");
  });
});
