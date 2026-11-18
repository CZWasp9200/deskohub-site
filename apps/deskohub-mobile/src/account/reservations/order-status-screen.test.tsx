import { describe, expect, mock, spyOn, test } from "bun:test";
import { RegistryProvider } from "@effect/atom-react";
import { DateTime, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AsyncView } from "../../customer-api/async-view";
import {
  accountAtom,
  customerDataLayer,
} from "../../customer-api/customer-data-runtime";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import {
  sampleOfficePeopleReservation,
  sampleOrderIds,
  sampleWorkspaceData,
} from "../../customer-api/testing/sample-fixtures";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";
import { PersonRow } from "../../ui/person-row";
import {
  elementTree,
  find,
  findAll,
  hostTree,
  textOf,
} from "../../ui/testing/element-tree";
import { orderStatusAtoms } from "./order-status-state";
import { reservationGroups } from "./reservation-list-model";
import { reservationsListAtom } from "./reservations-list-state";
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
const { OrderPeopleSection } = await import("./order-people-section");
const { ToastProvider } = await import("../../ui/toast");

/**
 * The screen's first paint, before its first status read has answered: the
 * markup a static render produces, with host components as their names.
 */
const withoutNativeWarnings = <A,>(render: () => A) => {
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
    return render();
  } finally {
    warnings.mockRestore();
  }
};

const firstPaint = (visit: StatusVisit) =>
  withoutNativeWarnings(() =>
    renderToStaticMarkup(
      withCustomerData(
        <OrderStatusScreen orderId={sampleOrderIds.pending} visit={visit} />
      )
    )
  );

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

test("the attending contact uses the booked-for customer only after history answers", () => {
  const now = new Date();
  const sample = sampleWorkspaceData("linked", now);
  const order = sample.orders.get(sampleOrderIds.officePeople)?.state;
  const people = order?.people;
  if (!order || !people?.contactAttends) {
    throw new Error("Expected an office order with an attending contact");
  }
  const customer = "Morgan Example";
  const at = DateTime.makeUnsafe(now);
  const inviteeNames = people.invitees.map(() => undefined);
  const reservation = sampleOfficePeopleReservation(now);
  const rows = (saved: boolean) => {
    const history = {
      ...sample.history,
      current: [
        saved
          ? reservation
          : {
              ...reservation,
              party: { kind: "booked-for" as const, customerName: customer },
            },
      ],
    };
    const list = {
      groups: reservationGroups(history, at),
      savedAt: saved ? Option.some(at) : Option.none(),
    };
    const tree = withoutNativeWarnings(() =>
      elementTree(OrderPeopleSection, { order, people }, (node) => (
        <AppLocaleProvider locale="en-US">
          <RegistryProvider
            initialValues={[
              Atom.initialValue(
                accountAtom,
                AsyncResult.success(sample.account)
              ),
              Atom.initialValue(
                reservationsListAtom,
                AsyncResult.success(list)
              ),
            ]}
          >
            <ToastProvider>{node}</ToastProvider>
          </RegistryProvider>
        </AppLocaleProvider>
      ))
    );
    return findAll(tree, PersonRow).map(({ props }) => props.name);
  };

  expect(rows(true)).toEqual(inviteeNames);
  expect(rows(false)).toEqual([customer, ...inviteeNames]);
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

    expect(labels).toContain(m.reservations_status_cancelled({}, { locale }));
    expect(labels).toContain(m.reservations_book_again({}, { locale }));
    expect(labels).not.toContain(
      m.reservations_step_awaiting_payment({}, { locale })
    );
    expect(labels).not.toContain(m.booking_checkout_retry_pay({}, { locale }));
    expect(labels).not.toContain(m.reservations_show_pin({}, { locale }));
    expect(labels).not.toContain(
      m.reservations_add_to_calendar({}, { locale })
    );
    expect(labels.includes(m.reservations_invoice_row({}, { locale }))).toBe(
      paymentStatus === "paid"
    );
  }
);
