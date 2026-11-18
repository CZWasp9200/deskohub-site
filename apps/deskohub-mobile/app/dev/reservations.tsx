import { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { RegistryProvider, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { Redirect, useLocalSearchParams } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ReservationAccessScreen } from "../../src/account/reservations/access-screen";
import {
  accessHeaderTone,
  accessScreenStateOf,
  reservationAccessAtom,
  shownAccess,
} from "../../src/account/reservations/access-screen-state";
import { OrderStatusScreen } from "../../src/account/reservations/order-status-screen";
import { ReservationsListScreen } from "../../src/account/reservations/reservations-list-screen";
import { statusVisitOf } from "../../src/account/reservations/status-refresh-rules";
import { WithdrawalScreen } from "../../src/account/reservations/withdrawal-screen";
import { customerDataLayer } from "../../src/customer-api/customer-data-runtime";
import type { FakeWorkspace } from "../../src/customer-api/testing/fake-workspace";
import { useAppLocale } from "../../src/i18n/locale-context";
import { m } from "../../src/i18n/messages";
import { AppBar } from "../../src/ui/app-bar";
import { FocusedStatusBar } from "../../src/ui/focused-status-bar";
import { color } from "../../src/ui/tokens";

// Metro drops this branch from release bundles, so the fake Workspace and
// its fixtures never ship there (see `customer-data-provider.tsx`).
const sampleData = __DEV__
  ? {
      layer: (
        require("../../src/customer-api/testing/sample-data-layer") as typeof import("../../src/customer-api/testing/sample-data-layer")
      ).sampleCustomerDataLayer,
      historyOf: (
        require("../../src/customer-api/testing/sample-history") as typeof import("../../src/customer-api/testing/sample-history")
      ).sampleHistoryOf,
    }
  : undefined;

/**
 * Development-only: the Reservations tab and the booking view over the
 * sample data, without signing in, so a capture can deep-link to every
 * state. `?history=<variant>` picks the list (`sample-history.ts`);
 * `?order=<id>` opens that order's booking view instead, with
 * `&after=payment` as the return from payment
 * (`deskohub://dev/reservations?order=sample-desk-pending&after=payment`),
 * and `?access=<id>` its access PIN
 * (`deskohub://dev/reservations?access=sample-desk-fulfilled&history=upcoming`).
 */
export default function ReservationsSampleRoute() {
  const params = useLocalSearchParams<{
    history?: string;
    order?: string;
    after?: string;
    access?: string;
    withdraw?: string;
  }>();
  if (!__DEV__ || sampleData === undefined) return <Redirect href="/" />;
  // A fresh registry for each state, as a new account would get.
  return (
    <SampleRegistry
      key={`${params.history ?? ""}/${params.order ?? ""}/${params.after ?? ""}/${params.access ?? ""}/${params.withdraw ?? ""}`}
      history={params.history}
      withdraw={params.withdraw}
    >
      <SampleScreen params={params} />
    </SampleRegistry>
  );
}

function SampleRegistry({
  history,
  withdraw,
  children,
}: {
  readonly history: string | undefined;
  readonly withdraw?: string | undefined;
  readonly children: ReactNode;
}) {
  const [initialValues] = useState(() =>
    sampleData === undefined
      ? []
      : [
          Atom.initialValue(
            customerDataLayer,
            sampleData.layer(
              "linked",
              sampleData.historyOf(history),
              (workspace) => configureWithdrawal(workspace, withdraw)
            )
          ),
        ]
  );
  return (
    <RegistryProvider initialValues={initialValues}>
      {children}
    </RegistryProvider>
  );
}

/** The access PIN, the booking view, or the list, as the params pick. */
function SampleScreen({
  params,
}: {
  readonly params: {
    readonly order?: string;
    readonly after?: string;
    readonly access?: string;
    readonly withdraw?: string;
  };
}) {
  if (params.withdraw !== undefined) {
    return <SampleWithdrawalView />;
  }
  if (params.access !== undefined) {
    return <SampleAccessView orderId={params.access} />;
  }
  if (params.order !== undefined) {
    return <SampleBookingView orderId={params.order} after={params.after} />;
  }
  return <ReservationsListScreen />;
}

/** The booking view under the app bar its stack would give it. */
function SampleBookingView({
  orderId,
  after,
}: {
  readonly orderId: string;
  readonly after: string | undefined;
}) {
  const locale = useAppLocale();
  const visit = statusVisitOf(after);
  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: color.paper }}
    >
      <FocusedStatusBar style="dark" />
      <AppBar
        title={
          visit === "after-payment"
            ? m.reservations_your_booking({}, { locale })
            : m.reservations_status_title({}, { locale })
        }
        back={visit === "after-payment" ? "close" : "back"}
        onBack={() => undefined}
      />
      <View style={{ flex: 1 }}>
        <OrderStatusScreen
          orderId={CustomerReservationOrderId.make(orderId)}
          visit={visit}
        />
      </View>
    </SafeAreaView>
  );
}

/**
 * The access PIN under the header its stack would give it: navy over the
 * PIN, the paper canvas's when there is no PIN.
 */
function SampleAccessView({ orderId }: { readonly orderId: string }) {
  const locale = useAppLocale();
  const id = CustomerReservationOrderId.make(orderId);
  const navy =
    accessHeaderTone(
      accessScreenStateOf(shownAccess(useAtomValue(reservationAccessAtom(id))))
    ) === "navy";
  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: navy ? color.navy : color.paper }}
    >
      <FocusedStatusBar style={navy ? "light" : "dark"} />
      <AppBar
        title={m.reservations_access_title({}, { locale })}
        onBack={() => undefined}
        tone={navy ? "navy" : "paper"}
      />
      <View style={{ flex: 1 }}>
        <ReservationAccessScreen orderId={id} />
      </View>
    </SafeAreaView>
  );
}

const czk = (value: number) =>
  ({ value: value * 100, exponent: 2, currency: "CZK" }) as const;

/**
 * `?withdraw=` picks the withdrawal quote the fake Workspace answers: `full`
 * (a day desk not started), `partial` (an office with 3 of 4 days started),
 * `fallback` (an account without a name), `pending` (the confirm never
 * answers), `refused` (the period ended), `loading` (the quote never answers).
 */
const configureWithdrawal = (
  workspace: FakeWorkspace,
  withdraw: string | undefined
) => {
  if (withdraw === undefined) return;
  const partial = withdraw === "partial";
  workspace.withdrawal =
    withdraw === "refused"
      ? "period_ended"
      : {
          contractId: CustomerReservationOrderId.make(sampleWithdrawalOrder),
          contractLabel: partial
            ? "Soukromá kancelář · 16.–19. 11. 2026"
            : "Profi · 7. 12. 2026",
          customerName: withdraw === "fallback" ? null : "Jana Nováková",
          receiptEmail: "jana.novakova@deskohub.test",
          paidAmount: partial ? czk(4800) : czk(550),
          refundAmount: partial ? czk(1200) : czk(550),
          refundBasis: partial
            ? { kind: "partial", unit: "day", unstarted: 1, total: 4 }
            : { kind: "full" },
          periodEndsAt: "2026-12-01T23:00:00.000Z",
        };
  if (withdraw === "loading")
    workspace.withdrawalQuoteDelay = new Promise(() => undefined);
  if (withdraw === "pending")
    workspace.withdrawalDelay = new Promise(() => undefined);
};

/** The order the withdrawal samples withdraw from. */
const sampleWithdrawalOrder = "sample-desk-fulfilled";

/** The withdrawal confirm step under the app bar its stack would give it. */
function SampleWithdrawalView() {
  const locale = useAppLocale();
  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: color.paper }}
    >
      <FocusedStatusBar style="dark" />
      <AppBar
        title={m.withdrawalConfirmTitle({}, { locale })}
        back="back"
        onBack={() => undefined}
      />
      <View style={{ flex: 1 }}>
        <WithdrawalScreen
          orderId={CustomerReservationOrderId.make(sampleWithdrawalOrder)}
        />
      </View>
    </SafeAreaView>
  );
}
