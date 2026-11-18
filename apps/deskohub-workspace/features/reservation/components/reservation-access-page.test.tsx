import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
} from "@/shared/utils/workspace-location-map";
import { ReservationAccessPage } from "./reservation-access-page";

const pragueMidnight = (date: string) =>
  Temporal.PlainDate.from(date).toZonedDateTime("Europe/Prague").toInstant();

describe("ReservationAccessPage", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("shows the current PIN and leaves validity to the lock", () => {
    const view = render(
      <ReservationAccessPage
        access={{
          state: "available",
          code: "2468",
          accessStartsAt: Temporal.Instant.from("2026-08-13T08:00:00Z"),
          accessEndsAt: Temporal.Instant.from("2026-08-13T16:00:00Z"),
        }}
        locale="en-US"
        orderId="reservation-access-page"
      />
    );

    const code = view.container.querySelector("[data-reservation-access-code]");
    if (!code) throw new Error("Access code output missing");
    expect(code.getAttribute("data-ph-mask")).toBe("");
    expect(code.getAttribute("data-ph-no-capture")).toBe("");
    expect(code.getAttribute("data-reservation-access-code")).toBe("");
    expect(code.getAttribute("aria-label")).toBe("2 4 6 8");
    expect(Array.from(code.children, (child) => child.textContent)).toEqual([
      "2",
      "4",
      "6",
      "8",
    ]);
    expect(view.getByText("Your access PIN")).toBeDefined();
    expect(
      view.getByText(
        /The lock accepts this PIN from Aug 13, 2026(?:,| at) 10:00 AM until Aug 13, 2026(?:,| at) 6:00 PM\./
      )
    ).toBeDefined();
    expect(view.container.querySelector("[data-reservation-access]")).toBe(
      code.closest("[data-reservation-access]")
    );
  });

  test("shows a code unavailable for any reason the same way", () => {
    const markupFor = (reason: "reservation-state" | "lookup-failed") => {
      const view = render(
        <ReservationAccessPage
          access={{ state: "unavailable", reason }}
          locale="en-US"
          orderId="reservation-access-page"
        />
      );
      const markup = view.container.innerHTML;
      cleanup();
      return markup;
    };

    expect(markupFor("lookup-failed")).toBe(markupFor("reservation-state"));
  });

  test("names whole access days without midnight times", () => {
    const leadFor = (endsOn: string) => {
      const view = render(
        <ReservationAccessPage
          access={{
            state: "available",
            code: "2468",
            accessStartsAt: pragueMidnight("2026-11-18"),
            accessEndsAt: pragueMidnight(endsOn),
          }}
          locale="en-US"
          orderId="reservation-access-page"
        />
      );
      const code = view.container.querySelector(
        "[data-reservation-access-code]"
      );
      const lead = code?.nextElementSibling?.textContent;
      cleanup();
      return lead;
    };

    expect(leadFor("2026-11-19")).toBe(
      m.reservationAccessDatesSingle(
        { date: "11/18/2026" },
        { locale: "en-US" }
      )
    );
    expect(leadFor("2026-11-21")).toBe(
      m.reservationAccessDatesRange(
        { startsOn: "11/18/2026", endsOn: "11/20/2026" },
        { locale: "en-US" }
      )
    );
  });

  test("shows an invited person the PIN, the booker, and the way there", async () => {
    const writeText = async (_text: string) => {};
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text);
          return writeText(text);
        },
      },
    });
    const view = render(
      <ReservationAccessPage
        access={{
          state: "available",
          code: "2468",
          accessStartsAt: pragueMidnight("2026-11-18"),
          accessEndsAt: pragueMidnight("2026-11-19"),
          viewer: "invitee",
          bookedBy: { name: "Alex Sample" },
        }}
        locale="en-US"
        orderId="reservation-access-page"
      />
    );

    expect(
      view.container.querySelector("[data-reservation-access-booked-by]")
        ?.textContent
    ).toBe(
      m.reservationAccessGuestBookedBy(
        {
          product: getWorkspaceOfficeProductTitle("en-US"),
          name: "Alex Sample",
        },
        { locale: "en-US" }
      )
    );
    expect(view.container.querySelector('a[href*="/reservation"]')).toBeNull();
    expect(
      view
        .getByRole("link", {
          name: m.reservationAccessGuestOpenRoute({}, { locale: "en-US" }),
        })
        .getAttribute("href")
    ).toBe(workspaceGoogleDirectionsUrl);

    const toast = view.container.querySelector("[data-toast]");
    if (!toast) throw new Error("Expected the toast region");
    expect(toast.textContent).toBe("");
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.reservationAccessGuestCopyAddress(
            { address: workspaceFormattedAddress },
            { locale: "en-US" }
          ),
        })
      );
    });
    expect(copied).toEqual([workspaceFormattedAddress]);
    expect(toast.textContent).toBe(
      m.reservationAccessGuestAddressCopied({}, { locale: "en-US" })
    );
  });
});
