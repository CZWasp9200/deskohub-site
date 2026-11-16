import { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { RegistryProvider } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { Redirect, useLocalSearchParams } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { OrderStatusScreen } from "../../src/account/reservations/order-status-screen";
import { ReservationsListScreen } from "../../src/account/reservations/reservations-list-screen";
import { statusVisitOf } from "../../src/account/reservations/status-refresh-rules";
import { customerDataLayer } from "../../src/customer-api/customer-data-runtime";
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
 * (`deskohub://dev/reservations?order=sample-desk-pending&after=payment`).
 */
export default function ReservationsSampleRoute() {
  const params = useLocalSearchParams<{
    history?: string;
    order?: string;
    after?: string;
  }>();
  if (!__DEV__ || sampleData === undefined) return <Redirect href="/" />;
  // A fresh registry for each state, as a new account would get.
  return (
    <SampleRegistry
      key={`${params.history ?? ""}/${params.order ?? ""}/${params.after ?? ""}`}
      history={params.history}
    >
      {params.order === undefined ? (
        <ReservationsListScreen />
      ) : (
        <SampleBookingView orderId={params.order} after={params.after} />
      )}
    </SampleRegistry>
  );
}

function SampleRegistry({
  history,
  children,
}: {
  readonly history: string | undefined;
  readonly children: ReactNode;
}) {
  const [initialValues] = useState(() =>
    sampleData === undefined
      ? []
      : [
          Atom.initialValue(
            customerDataLayer,
            sampleData.layer("linked", sampleData.historyOf(history))
          ),
        ]
  );
  return (
    <RegistryProvider initialValues={initialValues}>
      {children}
    </RegistryProvider>
  );
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
