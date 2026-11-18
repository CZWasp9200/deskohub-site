import "@/shared/polyfills/temporal";

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
import { testEmailAddress } from "@deskohub/test-email";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout";
import {
  type CheckoutStatusKind,
  checkoutStatusKinds,
} from "@/features/checkout/checkout-status-kind";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import { readContactPrefill } from "@/features/contact/components/contact-page-link";
import { type Locale, m } from "@/features/i18n";
import { formatReservationDisplayDate } from "@/features/reservation/reservation-date";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const testEmailAddressForAda = testEmailAddress("ada");

type CapturedLink = {
  readonly href: string;
  readonly prefetch: boolean | null | undefined;
};

const capturedLinks: CapturedLink[] = [];

mock.module("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly children?: ReactNode;
    readonly href: string | URL;
    readonly prefetch?: boolean | null;
  }) => {
    const stringHref = href.toString();
    capturedLinks.push({ href: stringHref, prefetch });
    return (
      <a data-next-link="" href={stringHref} {...props}>
        {children}
      </a>
    );
  },
}));

const { workspaceUseAction } = await import(
  "@/shared/testing/workspace-component-module-mocks"
);
mock.module("@/features/checkout/actions/reopen-payment-page", () => ({
  reopenPaymentPage: mock(),
}));
mock.module("@/features/checkout/actions/prepare-payment-retry", () => ({
  preparePaymentRetry: mock(),
}));

const { CheckoutStatusPage } = await import("./checkout-status-page");

beforeEach(() => {
  workspaceUseAction.mockReturnValue({
    execute: mock(),
    isExecuting: false,
  } as never);
});

const baseStatus: CheckoutStatusViewModel = {
  kind: "cowork",
  orderId: "reservation-status-page",
  returnOutcome: "success",
  status: "fulfilled",
  paymentStatus: "paid",
  fulfillmentStatus: "fulfilled",
};

const reconstructedCoworkStatus: CheckoutStatusViewModel = {
  ...baseStatus,
  summary: {
    kind: "cowork",
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x27-qhd",
    reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00.000Z"),
    reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00.000Z"),
    price: { value: 55_000, exponent: 2, currency: "CZK" },
  },
};

/** Asserts the missing-address fallback: no address shown or prefilled. */
const expectGuidanceWithoutAddress = (
  view: ReturnType<typeof render>,
  fallbackLead: string,
  supportLabel: string
) => {
  expect(view.getByText(fallbackLead)).toBeTruthy();
  expect(view.queryByText(/ada@example\.test/)).toBeNull();
  const support = view.getByRole("link", { name: supportLabel });
  const contactUrl = new URL(
    support.getAttribute("href") ?? "",
    "https://deskohub.local"
  );
  expect(contactUrl.searchParams.has("email")).toBe(false);
  expect(contactUrl.searchParams.get("name")).toBe("Ada Lovelace");
  expect(
    view.container.querySelector("#checkout-status-reserve-again")
  ).toBeNull();
  expect(
    view.container.querySelector("main ol > li:nth-child(1) > a")
  ).toBeNull();
};

describe("CheckoutStatusPage", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    capturedLinks.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders reconstructed reservation summary rows", () => {
    const view = render(
      <CheckoutStatusPage locale="en-US" status={reconstructedCoworkStatus} />
    );

    expect(view.getByText("Profi Workstation")).toBeDefined();
    expect(view.getByText("Saturday, June 20, 2026")).toBeDefined();
    expect(view.getByText("2x 27″ QHD")).toBeDefined();
    expect(view.getByText("CZK 550")).toBeDefined();
    const repeatLink = view.getByRole("link", { name: "Book again" });
    const repeatUrl = new URL(
      repeatLink.getAttribute("href") ?? "",
      "https://deskohub.local"
    );
    expect(repeatUrl.pathname).toBe("/en-US/reservation/cowork");
    expect(Object.fromEntries(repeatUrl.searchParams)).toEqual({
      entryTier: "profi",
      coffee: "true",
      monitorOption: "2x27-qhd",
    });
    expect(
      view.queryByText(m.checkoutStatusMissingSummary({}, { locale: "en-US" }))
    ).toBeNull();
  });

  test.each(["page", "modal"] as const)(
    "shows the assigned table without a seating map in %s presentation",
    (presentation) => {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          presentation={presentation}
          status={{
            ...reconstructedCoworkStatus,
            table: { mode: "assigned", name: "12" },
          }}
        />
      );

      const label = view.getByText("Table", { selector: "dt" });
      expect(label.nextElementSibling?.textContent).toBe("12");
      expect(view.queryByText("Your reserved table")).toBeNull();
    }
  );

  test.each([
    ["en-US", "Tables"],
    ["cs-CZ", "Stoly"],
  ] as const)("shows shared Open Space tables in %s", (locale, label) => {
    const view = render(
      <CheckoutStatusPage
        locale={locale}
        status={{
          ...baseStatus,
          summary: {
            reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00Z"),
            reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00Z"),
            price: { value: 55_000, exponent: 2, currency: "CZK" },
            kind: "cowork",
            entryTier: "open-space",
            coffee: false,
          },
          table: { mode: "shared", name: "1–3, 5" },
        }}
      />
    );

    expect(
      view.getByText(label, { selector: "dt" }).nextElementSibling?.textContent
    ).toBe("1–3, 5");
    expect(
      view.queryByText(locale === "en-US" ? "Table" : "Stůl", {
        selector: "dt",
      })
    ).toBeNull();
  });

  test("keeps reservation access outside the payment status page", () => {
    const view = render(
      <CheckoutStatusPage locale="en-US" status={baseStatus} />
    );

    expect(
      view.container.querySelector("[data-reservation-access]")
    ).toBeNull();
    expect(
      view.container.querySelector("[data-reservation-access-code]")
    ).toBeNull();
  });

  test("renders fulfilled modal content without the page shell or page CTAs", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        presentation="modal"
        status={reconstructedCoworkStatus}
      />
    );

    expect(view.container.querySelector("main")).toBeNull();
    expect(view.container.querySelector("ol")).toBeNull();
    expect(view.getByText("Reservation summary")).toBeDefined();
    expect(view.getByText("reservation-status-page")).toBeDefined();
    expect(view.getByText("Profi Workstation")).toBeDefined();
    expect(view.getByRole("link", { name: "Show access code" })).toBeDefined();
    expect(
      view.container.querySelector(
        '#checkout-status-access[href="/en-US/reservation/access/reservation-status-page"]'
      )
    ).not.toBeNull();
    expect(
      view.container.querySelector("#checkout-status-reserve-again")
    ).toBeNull();
    expect(view.queryByRole("link", { name: "Back home" })).toBeNull();
    expect(view.container.querySelector('a[href="/en-US"]')).toBeNull();
  });

  test("shows a review account's sandbox order without an access code", () => {
    for (const presentation of ["page", "modal"] as const) {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          presentation={presentation}
          status={{ ...reconstructedCoworkStatus, reviewSandbox: true }}
        />
      );

      expect(
        view.container.querySelector("#checkout-status-review-sandbox")
      ).not.toBeNull();
      expect(
        view.container.querySelector("#checkout-status-access")
      ).toBeNull();
      view.unmount();
    }
  });

  test("keeps support in a failed modal without reservation CTAs", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        presentation="modal"
        status={{
          ...baseStatus,
          status: "fulfillment_failed",
          fulfillmentStatus: "failed",
        }}
      />
    );

    expect(
      view.getByRole("link", { name: "Send support request" })
    ).toBeDefined();
    expect(
      view.container.querySelector("#checkout-status-reserve-again")
    ).toBeNull();
    expect(view.queryByRole("link", { name: "Back home" })).toBeNull();
  });

  test("omits modal CTAs for not-found and pending states", () => {
    const statuses: CheckoutStatusViewModel[] = [
      {
        orderId: "not-found-modal",
        returnOutcome: "unknown",
        status: "not_found",
      },
      {
        ...baseStatus,
        orderId: "pending-modal",
        status: "pending",
        paymentStatus: "pending",
        fulfillmentStatus: "not_started",
      },
    ];

    for (const status of statuses) {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          presentation="modal"
          status={status}
        />
      );

      expect(
        view.container.querySelector("#checkout-status-reserve-again")
      ).toBeNull();
      expect(view.queryByRole("link", { name: "Back home" })).toBeNull();
      expect(
        view.queryByRole("link", { name: "Send support request" })
      ).toBeNull();
      cleanup();
    }
  });

  test("tells the customer a late payment will be refunded instead of awaiting confirmation", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...reconstructedCoworkStatus,
          status: "late_payment_refund",
          paymentStatus: "paid",
          fulfillmentStatus: "not_started",
        }}
      />
    );

    expect(
      view.getByRole("heading", { name: "We will refund your payment." })
    ).toBeTruthy();
    expect(
      view.getByText(
        "Your payment arrived after the reservation was no longer available, so we could not confirm it and will refund the payment. Start a new reservation if you still want to book."
      )
    ).toBeTruthy();
    expect(
      view.queryByText("Payment received. We're finishing your reservation.")
    ).toBeNull();
    expect(view.container.querySelector("#checkout-status-access")).toBeNull();
    expect(
      view.container.querySelector("#checkout-status-reserve-again")
    ).not.toBeNull();
  });

  test("explains a late payment that is still being checked or needs review", () => {
    const cases = [
      {
        status: "late_payment_checking",
        title: "We are checking your reservation.",
        lead: "Your payment arrived after the reservation hold expired, so we are checking that the space is still available. Keep this page open; it will update automatically.",
      },
      {
        status: "late_payment_review",
        title: "We are reviewing your reservation.",
        lead: "Your payment arrived after the reservation hold expired, and we need to check your reservation manually. Please contact us so we can confirm the reservation or refund the payment.",
      },
    ] as const;

    for (const { lead, status, title } of cases) {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          status={{
            ...baseStatus,
            status,
            paymentStatus: "expired",
            fulfillmentStatus: "not_started",
          }}
        />
      );

      expect(view.getByRole("heading", { name: title })).toBeTruthy();
      expect(view.getByText(lead)).toBeTruthy();
      expect(
        view.container.querySelector("#checkout-status-access")
      ).toBeNull();
      cleanup();
    }
  });

  test("uses soft navigation for access only in modal presentation", () => {
    const accessHref = "/en-US/reservation/access/reservation-status-page";
    const modalView = render(
      <CheckoutStatusPage
        locale="en-US"
        presentation="modal"
        status={baseStatus}
      />
    );

    expect(
      modalView
        .getByRole("link", { name: "Show access code" })
        .getAttribute("href")
    ).toBe(accessHref);
    expect(capturedLinks).toContainEqual({
      href: accessHref,
      prefetch: false,
    });
    cleanup();
    capturedLinks.length = 0;

    const canonicalView = render(
      <CheckoutStatusPage locale="en-US" status={baseStatus} />
    );

    expect(
      canonicalView
        .getByRole("link", { name: "Show access code" })
        .getAttribute("href")
    ).toBe(accessHref);
    expect(capturedLinks.some(({ href }) => href === accessHref)).toBe(false);
    expect(
      canonicalView
        .getByRole("link", { name: "Show access code" })
        .getAttribute("data-next-link")
    ).toBeNull();
  });

  test("keeps the generic meeting-room start when exact duration is unavailable", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "meeting-room",
          summary: {
            kind: "meeting-room",
            reservedFrom: Temporal.Instant.from("2026-06-20T07:00:00.000Z"),
            reservedUntil: Temporal.Instant.from("2026-06-20T11:00:00.000Z"),
            price: { value: 155_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    expect(view.getByText("Meeting Room")).toBeDefined();
    expect(view.getByText("Saturday, June 20, 2026")).toBeDefined();
    expect(view.getByText(/9:00 AM.*1:00 PM/)).toBeDefined();
    expect(view.getByText("CZK 1,550")).toBeDefined();
    expect(
      view
        .getByRole("link", { name: "Start a new reservation" })
        .getAttribute("href")
    ).toBe("/en-US/reservation/meeting-room");
  });

  test("presents midnight-to-midnight meeting-room reservations as whole day", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "meeting-room",
          summary: {
            kind: "meeting-room",
            reservedFrom: Temporal.Instant.from("2026-03-28T23:00:00Z"),
            reservedUntil: Temporal.Instant.from("2026-03-29T22:00:00Z"),
            price: { value: 232_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    expect(view.getByText("whole day")).toBeDefined();
    expect(view.queryByText(/12:00 AM/)).toBeNull();
    expect(view.getByText("CZK 2,320")).toBeDefined();
  });

  test("renders office dates and seats and links to its entry point", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "office",
          summary: {
            kind: "office",
            reservedFrom: Temporal.Instant.from("2026-06-11T22:00:00Z"),
            reservedUntil: Temporal.Instant.from("2026-06-14T22:00:00Z"),
            seats: 3,
            price: { value: 442_500, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    expect(view.getByText("Private office")).toBeDefined();
    expect(
      view.getByText("Friday, June 12 – Sunday, June 14, 2026")
    ).toBeDefined();
    expect(view.getByText("Seats").parentElement?.textContent).toBe("Seats3");
    expect(view.getByText("CZK 4,425")).toBeDefined();
    expect(
      view.getByRole("link", { name: "Book again" }).getAttribute("href")
    ).toBe("/en-US/reservation/office?dayCount=3&seats=3");
  });

  test("lists who is coming to an office and sends an invitation again", async () => {
    const reservedFrom = Temporal.Instant.from("2026-11-17T23:00:00Z");
    const resendInvitation = mock(async () => ({
      status: "sent" as const,
      resendAvailableAt: Temporal.Now.instant().add({ seconds: 60 }).toString(),
    }));
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        resendInvitation={resendInvitation}
        status={{
          ...baseStatus,
          kind: "office",
          supportContactPrefill: {
            name: "Alex Sample",
            email: testEmailAddressForAda,
          },
          summary: {
            kind: "office",
            reservedFrom,
            reservedUntil: Temporal.Instant.from("2026-11-18T23:00:00Z"),
            seats: 2,
            price: { value: 116_000, exponent: 2, currency: "CZK" },
          },
          people: {
            contactAttends: true,
            invitees: [
              { id: "invitee-jana", email: "jana.novak@example.org" },
              {
                id: "invitee-petr",
                email: "petr.svoboda@example.org",
                resendAvailableAt: Temporal.Now.instant().add({ seconds: 60 }),
              },
            ],
            resendable: true,
          },
        }}
      />
    );

    const people = view.container.querySelector("[data-office-status-people]");
    expect(people?.textContent).toContain(
      m.checkoutStatusPeopleContact(
        { name: "Alex Sample" },
        { locale: "en-US" }
      )
    );
    expect(people?.textContent).toContain("jana.novak@example.org");
    expect(
      view.getByRole("button", {
        name: m.checkoutStatusPeopleResendLabel(
          { email: "petr.svoboda@example.org" },
          { locale: "en-US" }
        ),
      })
    ).toHaveProperty("disabled", true);
    expect(
      view.queryByText(
        m.checkoutStatusSummarySeatsLabel({}, { locale: "en-US" })
      )
    ).toBeNull();

    const changeLink = people?.querySelector("a");
    const changeHref = new URL(
      changeLink?.getAttribute("href") ?? "",
      "https://x.test"
    );
    expect(changeHref.pathname).toBe("/en-US/contact");
    expect(readContactPrefill(changeHref.searchParams)).toEqual({
      name: "Alex Sample",
      email: testEmailAddressForAda,
      phone: undefined,
      message: m.checkoutStatusPeopleChangeMessage(
        {
          reservationDetails: [
            m.checkoutStatusContactOrderReference(
              { orderId: baseStatus.orderId },
              { locale: "en-US" }
            ),
            m.checkoutStatusContactReservation(
              {
                reservation: getWorkspaceOfficeProductTitle("en-US"),
                date: formatReservationDisplayDate(reservedFrom, "en-US"),
              },
              { locale: "en-US" }
            ),
          ].join("\n"),
        },
        { locale: "en-US" }
      ),
    });

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.checkoutStatusPeopleResendLabel(
            { email: "jana.novak@example.org" },
            { locale: "en-US" }
          ),
        })
      );
    });
    expect(resendInvitation).toHaveBeenCalledWith({
      orderId: baseStatus.orderId,
      inviteeId: "invitee-jana",
    });
    expect(
      view.getByText(m.checkoutStatusPeopleSent({}, { locale: "en-US" }))
    ).toBeDefined();
    expect(
      view
        .getByText(
          m.checkoutStatusPeopleSentAnnouncement(
            { email: "jana.novak@example.org" },
            { locale: "en-US" }
          )
        )
        .getAttribute("role")
    ).toBe("status");
  });

  test("links the completed order step to the cowork repeat start as a raw document anchor", () => {
    const view = render(
      <CheckoutStatusPage locale="en-US" status={reconstructedCoworkStatus} />
    );

    const ctaHref = view.container
      .querySelector("#checkout-status-reserve-again")
      ?.getAttribute("href");
    const completedOrderStep = view.container.querySelector(
      "main ol > li:nth-child(1) > a"
    );
    expect(completedOrderStep).not.toBeNull();
    expect(completedOrderStep?.getAttribute("href")).toBe(ctaHref);
    expect(completedOrderStep?.getAttribute("data-next-link")).toBeNull();
    const stepHref = completedOrderStep?.getAttribute("href");
    expect(capturedLinks.some(({ href }) => href === stepHref)).toBe(false);

    const url = new URL(stepHref ?? "", "https://deskohub.local");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      entryTier: "profi",
      coffee: "true",
      monitorOption: "2x27-qhd",
    });
  });

  test("links the completed order step to the generic start for non-fulfilled status as a raw document anchor", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          status: "payment_failed",
          paymentStatus: "failed",
          fulfillmentStatus: "not_started",
          summary: {
            kind: "cowork",
            entryTier: "profi",
            coffee: true,
            monitorOption: "2x27-qhd",
            reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00Z"),
            reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00Z"),
            price: { value: 55_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    // Paying the same order again leads; the new reservation is its
    // fallback, which the completed order step links to.
    expect(
      view.container.querySelector("#checkout-status-try-payment-again")
    ).not.toBeNull();
    const completedOrderStep = view.container.querySelector(
      "main ol > li:nth-child(1) > a"
    );
    expect(completedOrderStep).not.toBeNull();
    expect(completedOrderStep?.getAttribute("href")).toBe(
      "/en-US/reservation/cowork"
    );
    expect(completedOrderStep?.getAttribute("data-next-link")).toBeNull();
    const stepHref = completedOrderStep?.getAttribute("href");
    expect(capturedLinks.some(({ href }) => href === stepHref)).toBe(false);

    const url = new URL(stepHref ?? "", "https://deskohub.local");
    expect(url.search).toBe("");
  });

  test("propagates only allowlisted booking shape", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={
          {
            ...baseStatus,
            orderId: "operational-order-id",
            supportContactPrefill: {
              name: "Sensitive Customer",
              email: testEmailAddress("sensitive"),
              phone: "+420777777777",
            },
            providerOrderId: "provider-order-id",
            paymentAttemptId: "payment-attempt-id",
            discountCode: "SECRET-DISCOUNT",
            accessCode: "123456",
            billing: {
              companyName: "Sensitive Invoice Company",
              taxId: "CZ12345678",
            },
            summary: {
              kind: "cowork",
              entryTier: "basic",
              coffee: false,
              reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00Z"),
              reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00Z"),
              price: { value: 35_000, exponent: 2, currency: "CZK" },
            },
          } as CheckoutStatusViewModel
        }
      />
    );

    const href = view
      .getByRole("link", { name: "Book again" })
      .getAttribute("href");
    const url = new URL(href ?? "", "https://deskohub.local");
    expect([...url.searchParams.keys()]).toEqual(["entryTier", "coffee"]);
    expect(href).not.toContain("operational-order-id");
    expect(href).not.toContain("Sensitive");
    expect(href).not.toContain(
      encodeURIComponent(testEmailAddress("sensitive"))
    );
    expect(href).not.toContain("provider-order-id");
    expect(href).not.toContain("payment-attempt-id");
    expect(href).not.toContain("SECRET-DISCOUNT");
    expect(href).not.toContain("123456");
    expect(href).not.toContain("Invoice");
    expect(href).not.toContain("CZ12345678");
    expect(href).not.toContain("35000");
    expect(href).not.toContain("2026-06");
    const completedOrderStep = view.container.querySelector(
      "main ol > li:nth-child(1) > a"
    );
    expect(completedOrderStep).not.toBeNull();
    expect(completedOrderStep?.getAttribute("href")).toBe(href);
  });

  test("keeps the generic office start for an unusable booking shape", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "office",
          summary: {
            kind: "office",
            reservedFrom: Temporal.Instant.from("2026-06-12T08:00:00Z"),
            reservedUntil: Temporal.Instant.from("2026-06-14T08:00:00Z"),
            seats: 3,
            price: { value: 442_500, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );
    expect(
      view
        .getByRole("link", { name: "Start a new reservation" })
        .getAttribute("href")
    ).toBe("/en-US/reservation/office");
  });

  test("renders prefilled support contact link for failed fulfillment", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "cowork",
          status: "fulfillment_failed",
          fulfillmentStatus: "failed",
          supportContactPrefill: {
            name: "Ada Lovelace",
            email: testEmailAddressForAda,
            phone: "+420777777777",
          },
          summary: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
            reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00.000Z"),
            reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00.000Z"),
            price: { value: 35_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    const link = view.getByRole("link", {
      name: "Send support request",
    });
    expect(link.id).toBe("checkout-status-support-contact");
    const href = link.getAttribute("href");
    expect(href?.startsWith("/en-US/contact?")).toBe(true);

    const contactUrl = new URL(href ?? "", "https://deskohub.local");
    expect(contactUrl.searchParams.get("name")).toBe("Ada Lovelace");
    expect(contactUrl.searchParams.get("email")).toBe(testEmailAddressForAda);
    expect(contactUrl.searchParams.get("phone")).toBe("+420777777777");
    expect(contactUrl.searchParams.get("message")).toBe(
      [
        "Hi Deskohub Workspace,",
        "",
        "My payment was received, but the reservation confirmation email did not arrive.",
        "",
        "Order reference: reservation-status-page",
        "Reservation: Basic Day Pass on Saturday, June 20, 2026",
        "",
        "Please help me get my secure access link.",
      ].join("\n")
    );
  });

  test.each([
    {
      locale: "en-US" as const,
      status: "fulfillment_failed" as const,
      expected: [
        "Hi Deskohub Workspace,",
        "",
        "My payment was received, but the reservation confirmation email did not arrive.",
        "",
        "Order reference: reservation-status-page",
        "",
        "Please help me get my secure access link.",
      ],
    },
    {
      locale: "en-US" as const,
      status: "late_payment_review" as const,
      expected: [
        "Hi Deskohub Workspace,",
        "",
        "My payment arrived after the reservation hold expired, and the payment status page says my reservation needs a manual check.",
        "",
        "Order reference: reservation-status-page",
        "",
        "Please confirm my reservation or refund the payment.",
      ],
    },
    {
      locale: "cs-CZ" as const,
      status: "payment_pending_delayed" as const,
      expected: [
        "Dobrý den,",
        "",
        "stránka se stavem platby u mé rezervace stále ukazuje, že se platba zpracovává.",
        "",
        "Číslo objednávky: reservation-status-page",
        "",
        "Prosím ověřte, jestli moje platba proběhla.",
      ],
    },
  ])(
    "leaves the reservation line out of the $status support request without reservation details ($locale)",
    ({ locale, status, expected }) => {
      const view = render(
        <CheckoutStatusPage
          locale={locale}
          status={{ ...baseStatus, status }}
        />
      );

      const href = view.container
        .querySelector("#checkout-status-support-contact")
        ?.getAttribute("href");
      const contactUrl = new URL(href ?? "", "https://deskohub.local");
      expect(contactUrl.searchParams.get("message")).toBe(expected.join("\n"));
    }
  );

  describe("a paid reservation awaiting its confirmation email", () => {
    const awaitingDeliveryStatus = (
      status: "paid_awaiting_delivery" | "paid_delivery_delayed",
      email: string | null = testEmailAddress("ada")
    ): CheckoutStatusViewModel => ({
      ...baseStatus,
      kind: "cowork",
      status,
      fulfillmentStatus: "awaiting_delivery",
      supportContactPrefill: {
        name: "Ada Lovelace",
        ...(email !== null && { email }),
      },
      summary: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
        reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00.000Z"),
        reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00.000Z"),
        price: { value: 35_000, exponent: 2, currency: "CZK" },
      },
    });

    test("shows the recipient address and does not invite another booking while delivery is recent", () => {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          status={awaitingDeliveryStatus("paid_awaiting_delivery")}
        />
      );

      expect(
        view.getByRole("heading", {
          name: "Your reservation is paid and confirmed.",
        })
      ).toBeTruthy();
      expect(view.getByText(testEmailAddress("ada"))).toBeTruthy();
      expect(view.getByText(/You don't need to book again\./)).toBeTruthy();
      expect(
        view.container.querySelector("#checkout-status-reserve-again")
      ).toBeNull();
      expect(
        view.container.querySelector("#checkout-status-support-contact")
      ).toBeNull();
      expect(view.getByRole("link", { name: "Back home" })).toBeTruthy();
    });

    test("replaces rebooking with a support request once delivery is overdue", () => {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          status={awaitingDeliveryStatus("paid_delivery_delayed")}
        />
      );

      expect(
        view.getByRole("heading", {
          name: "Your reservation is confirmed, but the email hasn't arrived yet.",
        })
      ).toBeTruthy();
      expect(view.getByText(testEmailAddress("ada"))).toBeTruthy();
      expect(view.getByText(/may contain a typo/)).toBeTruthy();
      expect(view.queryByText(/update/i)).toBeNull();
      expect(
        view.container.querySelector("#checkout-status-reserve-again")
      ).toBeNull();

      const link = view.getByRole("link", { name: "Send support request" });
      expect(link.id).toBe("checkout-status-support-contact");
      const contactUrl = new URL(
        link.getAttribute("href") ?? "",
        "https://deskohub.local"
      );
      expect(contactUrl.searchParams.get("email")).toBe(
        testEmailAddress("ada")
      );
      expect(contactUrl.searchParams.get("message")).toContain(
        "the reservation confirmation email did not arrive."
      );
    });

    test("keeps the overdue guidance when the recipient address is unavailable", () => {
      const view = render(
        <CheckoutStatusPage
          locale="cs-CZ"
          status={awaitingDeliveryStatus("paid_delivery_delayed", null)}
        />
      );

      expectGuidanceWithoutAddress(
        view,
        m.checkoutStatusPaidDeliveryDelayedLeadWithoutEmail(
          {},
          { locale: "cs-CZ" }
        ),
        "Zaslat žádost o podporu"
      );
    });
  });

  describe("a paid reservation without a delivered confirmation", () => {
    const paidStatus = (
      overrides: Partial<CheckoutStatusViewModel> & {
        readonly status: CheckoutStatusViewModel["status"];
      },
      email: string | null = testEmailAddress("ada")
    ) =>
      ({
        ...baseStatus,
        kind: "cowork",
        paymentStatus: "paid",
        fulfillmentStatus: "processing",
        supportContactPrefill: {
          name: "Ada Lovelace",
          ...(email !== null && { email }),
        },
        summary: {
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
          reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00.000Z"),
          reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00.000Z"),
          price: { value: 35_000, exponent: 2, currency: "CZK" },
        },
        ...overrides,
      }) as CheckoutStatusViewModel;
    const queryRestartActions = (container: HTMLElement) => ({
      reserveAgain: container.querySelector("#checkout-status-reserve-again"),
      orderStep: container.querySelector("main ol > li:nth-child(1) > a"),
    });

    test("points a bounced confirmation to support with its address instead of a rebook", () => {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          status={paidStatus({
            status: "fulfillment_failed",
            fulfillmentStatus: "failed",
          })}
        />
      );

      expect(view.getByText(testEmailAddress("ada"))).toBeTruthy();
      expect(
        view.getByText(
          /Your payment went through and your reservation is saved/
        )
      ).toBeTruthy();
      expect(view.getByText(/You don't need to book again\./)).toBeTruthy();
      expect(view.queryByText(/confirmed/)).toBeNull();
      expect(
        view.getByRole("link", { name: "Send support request" })
      ).toBeTruthy();
      expect(queryRestartActions(view.container)).toEqual({
        reserveAgain: null,
        orderStep: null,
      });
    });

    test("keeps bounced-confirmation guidance without a known address", () => {
      const view = render(
        <CheckoutStatusPage
          locale="cs-CZ"
          status={paidStatus(
            { status: "fulfillment_failed", fulfillmentStatus: "failed" },
            null
          )}
        />
      );

      expectGuidanceWithoutAddress(
        view,
        m.checkoutStatusFulfillmentFailedLeadWithoutEmail(
          {},
          { locale: "cs-CZ" }
        ),
        "Zaslat žádost o podporu"
      );
    });

    test("tells a customer whose payment is processing not to book again", () => {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          status={paidStatus({
            status: "pending",
            paymentStatus: "pending",
            fulfillmentStatus: "not_started",
          })}
        />
      );

      expect(
        view.getByRole("heading", {
          name: "Your payment is still being processed.",
        })
      ).toBeTruthy();
      expect(view.getByText(/You don't need to book again\./)).toBeTruthy();
      expect(view.queryByText(/confirmed/)).toBeNull();
      expect(
        view.container.querySelector("#checkout-status-support-contact")
      ).toBeNull();
      expect(queryRestartActions(view.container)).toEqual({
        reserveAgain: null,
        orderStep: null,
      });
    });

    test("points a payment unconfirmed past the cutoff to support, not a new checkout", () => {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          status={paidStatus({
            status: "payment_pending_delayed",
            paymentStatus: "pending",
            fulfillmentStatus: "not_started",
          })}
        />
      );

      // A local release cannot stop the provider payment from settling later.
      expect(
        view.getByText(
          /Don't book again until we confirm your payment or you hear from us/
        )
      ).toBeTruthy();
      expect(view.queryByText(/release/i)).toBeNull();
      const link = view.getByRole("link", { name: "Send support request" });
      const contactUrl = new URL(
        link.getAttribute("href") ?? "",
        "https://deskohub.local"
      );
      expect(contactUrl.searchParams.get("email")).toBe(
        testEmailAddress("ada")
      );
      expect(contactUrl.searchParams.get("message")).toContain(
        "Please check whether my payment went through."
      );
      expect(queryRestartActions(view.container)).toEqual({
        reserveAgain: null,
        orderStep: null,
      });
    });

    test("tells a paid customer awaiting confirmation not to book again", () => {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          status={paidStatus({ status: "paid_waiting_fulfillment" })}
        />
      );

      expect(
        view.getByRole("heading", {
          name: "Payment received. We're finishing your reservation.",
        })
      ).toBeTruthy();
      expect(view.getByText(/You don't need to book again\./)).toBeTruthy();
      expect(view.queryByText(/confirmed/)).toBeNull();
      expect(queryRestartActions(view.container)).toEqual({
        reserveAgain: null,
        orderStep: null,
      });
    });

    test("offers support once finishing a paid reservation takes too long", () => {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          status={paidStatus({ status: "paid_fulfillment_delayed" })}
        />
      );

      expect(view.getByText(/You don't need to book again\./)).toBeTruthy();
      expect(view.queryByText(/confirmed/)).toBeNull();
      const link = view.getByRole("link", { name: "Send support request" });
      expect(
        new URL(
          link.getAttribute("href") ?? "",
          "https://deskohub.local"
        ).searchParams.get("email")
      ).toBe(testEmailAddress("ada"));
      expect(queryRestartActions(view.container)).toEqual({
        reserveAgain: null,
        orderStep: null,
      });
    });
  });

  test("asks the customer to contact us about a late payment under review", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          kind: "cowork",
          status: "late_payment_review",
          paymentStatus: "paid",
          fulfillmentStatus: "not_started",
          supportContactPrefill: {
            name: "Ada Lovelace",
            email: testEmailAddressForAda,
          },
          summary: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
            reservedFrom: Temporal.Instant.from("2026-06-19T22:00:00.000Z"),
            reservedUntil: Temporal.Instant.from("2026-06-20T22:00:00.000Z"),
            price: { value: 35_000, exponent: 2, currency: "CZK" },
          },
        }}
      />
    );

    expect(view.queryByText(/We will email you/)).toBeNull();
    const link = view.getByRole("link", { name: "Send support request" });
    expect(link.id).toBe("checkout-status-support-contact");
    const contactUrl = new URL(
      link.getAttribute("href") ?? "",
      "https://deskohub.local"
    );
    expect(contactUrl.pathname).toBe("/en-US/contact");
    expect(contactUrl.searchParams.get("email")).toBe(testEmailAddressForAda);
    expect(contactUrl.searchParams.get("message")).toBe(
      [
        "Hi Deskohub Workspace,",
        "",
        "My payment arrived after the reservation hold expired, and the payment status page says my reservation needs a manual check.",
        "",
        "Order reference: reservation-status-page",
        "Reservation: Basic Day Pass on Saturday, June 20, 2026",
        "",
        "Please confirm my reservation or refund the payment.",
      ].join("\n")
    );
  });
});

describe("CheckoutStatusPage outcome sentences", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  const outcomes = [
    {
      status: "fulfilled",
      paymentStatus: "paid",
      fulfillmentStatus: "fulfilled",
      lead: m.checkoutStatusFulfilledLead,
      promisesDetailsEmail: true,
    },
    {
      status: "paid_awaiting_delivery",
      paymentStatus: "paid",
      fulfillmentStatus: "awaiting_delivery",
      lead: m.checkoutStatusPaidAwaitingDeliveryLeadWithoutEmail,
      promisesDetailsEmail: true,
    },
    {
      status: "pending",
      paymentStatus: "pending",
      fulfillmentStatus: "not_started",
      lead: m.checkoutStatusPendingLead,
      promisesDetailsEmail: true,
    },
    {
      status: "payment_failed",
      paymentStatus: "failed",
      fulfillmentStatus: "not_started",
      lead: m.checkoutStatusPaymentFailedLead,
      promisesDetailsEmail: false,
    },
    {
      status: "cancelled",
      paymentStatus: "cancelled",
      fulfillmentStatus: "not_started",
      lead: m.checkoutStatusCancelledLead,
      promisesDetailsEmail: false,
    },
    {
      status: "expired",
      paymentStatus: "expired",
      fulfillmentStatus: "not_started",
      lead: m.checkoutStatusExpiredLead,
      promisesDetailsEmail: false,
    },
  ] as const;

  test.each(
    outcomes.flatMap((outcome) =>
      (["en-US", "cs-CZ"] as const satisfies readonly Locale[]).map(
        (locale) => ({ ...outcome, locale })
      )
    )
  )(
    "server-renders the $status sentence as plain text in $locale",
    ({
      fulfillmentStatus,
      lead,
      locale,
      paymentStatus,
      promisesDetailsEmail,
      status,
    }) => {
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(
        <CheckoutStatusPage
          locale={locale}
          status={{ ...baseStatus, status, paymentStatus, fulfillmentStatus }}
        />
      );

      const sentence = lead({}, { locale });
      expect(
        [...container.querySelectorAll("p")].some(
          (paragraph) => paragraph.textContent === sentence
        )
      ).toBe(true);
      expect(
        container.textContent?.includes(
          m.checkoutStatusMissingSummary({}, { locale })
        )
      ).toBe(promisesDetailsEmail);
    }
  );
});

describe("CheckoutStatusPage payment retry", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  const retries = [
    {
      kind: "cowork",
      retrySelection: {
        kind: "cowork",
        entryTier: "reserved-desk",
        date: "2099-06-12",
        coffee: true,
        monitorOption: undefined,
      },
      href: "/en-US/reservation/cowork?entryTier=reserved-desk&date=2099-06-12&coffee=true&monitorOption=none",
    },
    {
      kind: "meeting-room",
      retrySelection: {
        kind: "meeting-room",
        startDateTime: "2099-08-13T14:00",
        duration: "hour:4",
      },
      href: "/en-US/reservation/meeting-room?startDateTime=2099-08-13T14%3A00&duration=hour%3A4",
    },
    {
      kind: "office",
      retrySelection: {
        kind: "office",
        startsOn: "2099-06-20",
        dayCount: 5,
        seats: 4,
      },
      href: "/en-US/reservation/office?startsOn=2099-06-20&dayCount=5&seats=4",
    },
  ] as const;
  const retryStatuses = [
    { status: "payment_failed", paymentStatus: "failed" },
    { status: "cancelled", paymentStatus: "cancelled" },
    { status: "expired", paymentStatus: "expired" },
  ] as const;

  test.each(
    retries.flatMap((retry) =>
      retryStatuses.map((status) => ({ ...retry, ...status }))
    )
  )(
    "offers paying the same order again after a $status payment, with the $kind selection as its fallback",
    ({ href, kind, paymentStatus, retrySelection, status }) => {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          status={{
            ...baseStatus,
            kind,
            status,
            paymentStatus,
            fulfillmentStatus: "not_started",
            retrySelection,
          }}
        />
      );

      expect(
        view.container.querySelector("#checkout-status-try-payment-again")
      ).not.toBeNull();
      expect(
        view.container.querySelector("#checkout-status-reserve-again")
      ).toBeNull();
      expect(
        view.container
          .querySelector("main ol > li:nth-child(1) > a")
          ?.getAttribute("href")
      ).toBe(href);
    }
  );

  test("ignores a retry selection on a status that offers no retry", () => {
    const view = render(
      <CheckoutStatusPage
        locale="en-US"
        status={{
          ...baseStatus,
          status: "late_payment_refund",
          paymentStatus: "expired",
          fulfillmentStatus: "not_started",
          retrySelection: retries[0].retrySelection,
        }}
      />
    );

    const cta = view.container.querySelector("#checkout-status-reserve-again");
    expect(cta?.textContent).toBe(
      m.checkoutStatusReserveAgain({}, { locale: "en-US" })
    );
    expect(cta?.getAttribute("href")).toBe("/en-US/reservation/cowork");
  });
});

describe("CheckoutStatusPage payment page reopening", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  const openPaymentPageSelector = "#checkout-status-open-payment-page";
  const backHome = m.checkoutStatusBackHome({}, { locale: "en-US" });

  test.each(["page", "modal"] as const)(
    "leads the actions with the payment page while the payment is pending in %s presentation",
    (presentation) => {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          presentation={presentation}
          status={{
            ...baseStatus,
            status: "pending",
            paymentStatus: "pending",
            fulfillmentStatus: "not_started",
            paymentPageReopenable: true,
          }}
        />
      );

      const openPaymentPage = view.container.querySelector(
        openPaymentPageSelector
      );
      expect(openPaymentPage?.tagName).toBe("BUTTON");
      expect(openPaymentPage?.parentElement?.firstElementChild).toBe(
        openPaymentPage
      );
      expect(view.queryByRole("link", { name: backHome }) !== null).toBe(
        presentation === "page"
      );
    }
  );

  const statusesWithoutPaymentPage: readonly CheckoutStatusViewModel[] = [
    {
      orderId: "reservation-no-payment-page",
      returnOutcome: "unknown",
      status: "not_found",
    },
    // Pending past the page's reopening window.
    {
      ...baseStatus,
      status: "pending",
      paymentStatus: "pending",
      fulfillmentStatus: "not_started",
    },
    ...checkoutStatusKinds
      .filter(
        (kind): kind is Exclude<CheckoutStatusKind, "not_found" | "pending"> =>
          kind !== "not_found" && kind !== "pending"
      )
      .map(
        (kind): CheckoutStatusViewModel => ({
          ...baseStatus,
          status: kind,
          paymentStatus: "pending",
          fulfillmentStatus: "not_started",
          paymentPageReopenable: true,
        })
      ),
  ];

  test.each(
    statusesWithoutPaymentPage.flatMap((status) =>
      (["page", "modal"] as const).map((presentation) => ({
        kind:
          status.status === "pending"
            ? "pending past its window"
            : status.status,
        presentation,
        status,
      }))
    )
  )(
    "offers no payment page for $kind in $presentation presentation",
    ({ presentation, status }) => {
      const view = render(
        <CheckoutStatusPage
          locale="en-US"
          presentation={presentation}
          status={status}
        />
      );

      expect(view.container.querySelector(openPaymentPageSelector)).toBeNull();
    }
  );
});
