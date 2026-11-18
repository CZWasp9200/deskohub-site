import { expect, mock, spyOn, test } from "bun:test";
import { RegistryContext } from "@effect/atom-react";
import { Result } from "effect";
import type { AtomRegistry } from "effect/reactivity";
import type { ReactElement } from "react";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { AppLocaleProvider } from "../../i18n/locale-context";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";
import { findAll, hostTree, textOf } from "../../ui/testing/element-tree";
import { invitedReservationsAtom } from "./invited-reservations";
import { reservationHistoryAtom } from "./reservations-list-state";

mock.module("expo-router", () => expoRouterStandIn());

const { ReservationsListScreen } = await import("./reservations-list-screen");
const { ToastProvider } = await import("../../ui/toast");

const screenText = (registry: AtomRegistry.AtomRegistry) => {
  const within = (node: ReactElement) => (
    <RegistryContext.Provider value={registry}>
      <AppLocaleProvider locale="en-US">
        <ToastProvider>{node}</ToastProvider>
      </AppLocaleProvider>
    </RegistryContext.Provider>
  );
  const { error } = console;
  const warnings = spyOn(console, "error").mockImplementation((...args) => {
    if (!/incorrect casing|does not recognize the/.test(String(args[0])))
      error(...args);
  });
  try {
    return findAll(hostTree(<ReservationsListScreen />, within), "Text")
      .map(textOf)
      .join("\n");
  } finally {
    warnings.mockRestore();
  }
};

test.each(["completion-required", "linked"] as const)(
  "lists invitations independently of own history for a %s account",
  async (kind) => {
    const sample = FakeWorkspace.forKind(kind).data;
    const invitation = sample.invited?.current[0];
    if (!invitation?.bookedBy.name) throw new Error("Expected a sample invite");
    const workspace = new FakeWorkspace(
      kind === "linked"
        ? {
            ...sample,
            invited: {
              current: [],
              past: [
                { ...invitation, accessStartsAt: null, accessEndsAt: null },
              ],
            },
          }
        : sample
    );
    workspace.fail("listReservations", "service-unavailable");
    const { registry } = makeFakeCustomerData(kind, workspace);

    const releaseAccount = registry.mount(accountAtom);
    const releaseInvitations = registry.mount(invitedReservationsAtom);
    const releaseHistory =
      kind === "linked" ? registry.mount(reservationHistoryAtom) : undefined;
    try {
      await settle(registry, accountAtom);
      expect(
        Result.isSuccess(await settle(registry, invitedReservationsAtom))
      ).toBe(true);
      if (kind === "linked") {
        expect(
          Result.isFailure(await settle(registry, reservationHistoryAtom))
        ).toBe(true);
      } else {
        expect(workspace.calls).not.toContain("listReservations");
      }
      expect(screenText(registry)).toContain(invitation.bookedBy.name);
    } finally {
      releaseAccount();
      releaseInvitations();
      releaseHistory?.();
      registry.dispose();
    }
  }
);
