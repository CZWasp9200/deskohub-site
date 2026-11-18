import { describe, expect, mock, spyOn, test } from "bun:test";
import { RegistryProvider } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
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
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";
import { elementTree, find } from "../../ui/testing/element-tree";
import type { StatusVisit } from "./status-refresh-rules";

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
    return renderStatusScreen(visit);
  } finally {
    warnings.mockRestore();
  }
};

/** `screen` under the locale and the fake customer data it reads. */
const withCustomerData = (screen: ReactElement) => (
  <AppLocaleProvider locale="en-US">
    <RegistryProvider
      initialValues={[
        Atom.initialValue(
          customerDataLayer,
          fakeCustomerDataLayer({
            workspace: FakeWorkspace.forKind("linked"),
            device: makeFakeDevice(),
          })
        ),
      ]}
    >
      {screen}
    </RegistryProvider>
  </AppLocaleProvider>
);

const renderStatusScreen = (visit: StatusVisit) =>
  renderToStaticMarkup(
    withCustomerData(
      <OrderStatusScreen orderId={sampleOrderIds.pending} visit={visit} />
    )
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
