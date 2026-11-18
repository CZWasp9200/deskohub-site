import { describe, expect, mock, spyOn, test } from "bun:test";
import { CustomerAccessCodeUnavailable } from "@deskohub/workspace-customer-api";
import { RegistryContext } from "@effect/atom-react";
import { Cause, DateTime, Option } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import type { NativeStackHeaderProps } from "expo-router";
import { isValidElement, type ReactElement } from "react";
import { reservationsHref } from "../../booking/booking-routes";
import {
  sampleOfficePeopleReservation,
  sampleOrderIds,
  sampleWorkspaceData,
} from "../../customer-api/testing/sample-fixtures";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";
import { findAll, hostTree, textOf } from "../../ui/testing/element-tree";
import { reservationAccessAtom } from "./access-screen-state";
import { invitedReservationsAtom } from "./invited-reservations";
import { orderStatusAtoms } from "./order-status-state";
import { reservationGroups } from "./reservation-list-model";
import { reservationsListAtom } from "./reservations-list-state";
import { AutomaticRefresh } from "./status-refresh-rules";

mock.module("expo-router", () => expoRouterStandIn());
// Bun can't load expo-router's bundled React Navigation; its title rule is
// the string `headerTitle`, then `title`, then the route's name.
mock.module("expo-router/react-navigation", () => ({
  getHeaderTitle: (
    options: { readonly title?: string; readonly headerTitle?: unknown },
    fallback: string
  ) =>
    typeof options.headerTitle === "string"
      ? options.headerTitle
      : (options.title ?? fallback),
}));
// Contact us only needs the origin, not the native auth client.
mock.module("../../auth/auth-client", () => ({
  apiOrigin: "https://workspace.test",
}));

const { accessStackHeader, ReservationAccessScreen } = await import(
  "./access-screen"
);
const { StackHeader } = await import("../../ui/navigation");
const navigation = await import("expo-router");

describe("accessStackHeader", () => {
  test("in both tones, Back from a PIN with nothing behind it opens the Reservations list", () => {
    for (const tone of ["navy", "paper"] as const) {
      const header = accessStackHeader[tone]({} as NativeStackHeaderProps);
      expect(isValidElement(header) && header.type === StackHeader).toBe(true);
      expect({
        tone,
        backFallback: (header.props as { backFallback?: string }).backFallback,
      }).toEqual({
        tone,
        backFallback: reservationsHref,
      });
    }
  });
});

test.each([
  ["cold access", false],
  ["an invitation", false],
  ["saved history", false],
  ["fresh own history", true],
  ["the status screen", true],
] as const)("no PIN returns correctly from %s", (entry, returnToStatus) => {
  const now = new Date();
  const at = DateTime.makeUnsafe(now);
  const sample = sampleWorkspaceData("linked", now);
  const orderId =
    entry === "an invitation"
      ? sampleOrderIds.officeInvited
      : sampleOrderIds.officePeople;
  const order = sample.orders.get(orderId)?.state;
  if (!order) throw new Error("Expected sample order");
  const hasRow = entry === "fresh own history" || entry === "saved history";
  const registry = AtomRegistry.make({
    initialValues: [
      Atom.initialValue(
        reservationAccessAtom(orderId),
        AsyncResult.failure(Cause.fail(new CustomerAccessCodeUnavailable()))
      ),
      Atom.initialValue(
        invitedReservationsAtom,
        entry === "an invitation" && sample.invited
          ? AsyncResult.success(sample.invited)
          : AsyncResult.initial(true)
      ),
      Atom.initialValue(
        reservationsListAtom,
        hasRow
          ? AsyncResult.success({
              groups: reservationGroups(
                {
                  ...sample.history,
                  current: [sampleOfficePeopleReservation(now)],
                },
                at
              ),
              savedAt:
                entry === "saved history" ? Option.some(at) : Option.none(),
            })
          : AsyncResult.initial(true)
      ),
      Atom.initialValue(
        orderStatusAtoms.status(orderId),
        entry === "the status screen"
          ? AsyncResult.success({
              order,
              reading: false,
              attempt: 0,
              automatic: AutomaticRefresh.Stopped({ reason: "settled" }),
              failure: Option.none(),
            })
          : AsyncResult.initial(true)
      ),
    ],
  });
  const dismissTo = mock();
  const router = spyOn(navigation, "useRouter").mockReturnValue({
    ...navigation.useRouter(),
    dismissTo,
  });
  const within = (node: ReactElement) => (
    <RegistryContext.Provider value={registry}>
      <AppLocaleProvider locale="en-US">{node}</AppLocaleProvider>
    </RegistryContext.Provider>
  );
  try {
    const tree = hostTree(
      <ReservationAccessScreen orderId={orderId} />,
      within
    );
    const locale = { locale: "en-US" } as const;
    const contact = m.reservations_contact({}, locale);
    const back = findAll(tree, "Pressable").find(
      (button) =>
        button.props.role === "button" &&
        !findAll(button, "Text").some((label) => textOf(label) === contact)
    );
    const press = back?.props.onPress;
    if (typeof press !== "function")
      throw new Error("Expected a return button");
    press();
    expect(dismissTo).toHaveBeenCalledWith(
      returnToStatus
        ? { pathname: "/reservations/[orderId]", params: { orderId } }
        : reservationsHref
    );
    expect(findAll(back, "Text").map(textOf)).toContain(
      returnToStatus
        ? m.reservations_access_back_to_booking({}, locale)
        : m.account_section_reservations({}, locale)
    );
  } finally {
    router.mockRestore();
    registry.dispose();
  }
});
