import { describe, expect, mock, spyOn, test } from "bun:test";
import { RegistryProvider } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AsyncView } from "../../customer-api/async-view";
import { customerDataLayer } from "../../customer-api/customer-data-runtime";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { sampleOrderIds } from "../../customer-api/testing/sample-fixtures";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";
import {
  elementTree,
  find,
  findAll,
  hostTree,
  textOf,
} from "../../ui/testing/element-tree";
import { orderStatusAtoms } from "./order-status-state";
import type { StatusRefreshState } from "./status-refresh";
import { AutomaticRefresh, type StatusVisit } from "./status-refresh-rules";

// The stand-in's focus effect never runs the screen's callback, so the
// screen stays unfocused and its first status read hasn't started.
mock.module("expo-router", () => expoRouterStandIn());
// Contact us only needs the origin, not the native auth client.
mock.module("../../auth/auth-client", () => ({
  apiOrigin: "https://workspace.test",
}));

const { OrderStatusScreen } = await import("./order-status-screen");
const { BookingTicketSkeleton } = await import("./booking-ticket");

/**
 * The screen's first paint, before its first status read has answered: the
 * markup a static render produces, with host components as their names.
 */
const firstPaint = (visit: StatusVisit) => {
  // React DOM warns about the React Native host names and props it renders.
  const { error } = console;
  const warnings = spyOn(console, "error").mockImplementation((...args) => {
    if (
      !/incorrect casing|does not recognize the|non-boolean attribute/.test(
        String(args[0])
      )
    )
      error(...args);
  });
  try {
    return renderToStaticMarkup(
      withCustomerData(
        <OrderStatusScreen orderId={sampleOrderIds.pending} visit={visit} />
      )
    );
  } finally {
    warnings.mockRestore();
  }
};

/** `screen` under the locale and the fake customer data it reads. */
const withCustomerData = (screen: ReactElement, state?: StatusRefreshState) => (
  <AppLocaleProvider locale="cs-CZ">
    <RegistryProvider
      initialValues={[
        Atom.initialValue(
          customerDataLayer,
          fakeCustomerDataLayer({
            workspace: FakeWorkspace.forKind("linked"),
            device: makeFakeDevice(),
          })
        ),
        ...(state
          ? [
              Atom.initialValue(
                orderStatusAtoms.status(state.order.orderId),
                AsyncResult.success(state)
              ),
            ]
          : []),
      ]}
    >
      {screen}
    </RegistryProvider>
  </AppLocaleProvider>
);

/** What the screen shows while its first read is under way. */
const loadingContent = (visit: StatusVisit) => {
  const screen = elementTree(
    OrderStatusScreen,
    { orderId: sampleOrderIds.pending, visit },
    withCustomerData
  );
  return find(screen, AsyncView)?.props.loading;
};

const headings = (markup: string) =>
  [...markup.matchAll(/<Text[^>]*role="heading"[^>]*>([^<]*)<\/Text>/g)].map(
    (match) => match[1]
  );

const progressBars = (markup: string) =>
  [...markup.matchAll(/<View[^>]*role="progressbar"[^>]*>/g)].length;

// The deep-link return from payment opened on a lone spinner, which read as
// a blank screen until the first read answered (#1131). The screen opens on
// the booking ticket's skeleton instead, in its final layout, with no
// headline (#1235).
describe("the booking view before its first read answers", () => {
  for (const visit of ["after-payment", "normal"] as const) {
    test(`shows one labelled skeleton and no headline (${visit})`, () => {
      const markup = firstPaint(visit);
      expect(headings(markup)).toEqual([]);
      expect(progressBars(markup)).toBe(1);
      const loading = loadingContent(visit);
      expect(isValidElement(loading) && loading.type).toBe(
        BookingTicketSkeleton
      );
    });

    // Every action is a Pressable host, so none may be in the markup.
    test(`offers no action yet (${visit})`, () => {
      expect(firstPaint(visit)).not.toMatch(/<Pressable\b/);
    });
  }
});

test.each(["pending", "paid"] as const)(
  "the opened Czech reservation shows cancellation with payment %s",
  (paymentStatus) => {
    const locale = "cs-CZ";
    const state: StatusRefreshState = {
      order: {
        orderId: sampleOrderIds.pending,
        kind: "cowork",
        status: "cancelled",
        reservationCancelled: true,
        paymentStatus,
        fulfillmentStatus: "not_started",
        startsAt: "2099-06-20T08:00:00Z",
        endsAt: "2099-06-20T16:00:00Z",
        bookedSelection: {
          selection: {
            family: "cowork",
            date: "2099-06-20",
            tier: "open-space",
          },
        },
      },
      reading: false,
      automatic: AutomaticRefresh.Stopped({ reason: "settled" }),
      attempt: 0,
      failure: Option.none(),
    };
    const tree = hostTree(
      <OrderStatusScreen orderId={state.order.orderId} visit="normal" />,
      (screen) => withCustomerData(screen, state)
    );
    const labels = findAll(tree, "Text").map(textOf);

    expect(labels).toContain(m.reservationStatusCancelled({}, { locale }));
    expect(labels).toContain(m.reservations_book_again({}, { locale }));
    expect(labels).not.toContain(
      m.reservations_step_awaiting_payment({}, { locale })
    );
    expect(labels).not.toContain(m.booking_checkout_retry_pay({}, { locale }));
    expect(labels).not.toContain(m.reservationShowPinCode({}, { locale }));
    expect(labels).not.toContain(
      m.reservations_add_to_calendar({}, { locale })
    );
    expect(labels.includes(m.reservations_invoice_row({}, { locale }))).toBe(
      paymentStatus === "paid"
    );
  }
);
