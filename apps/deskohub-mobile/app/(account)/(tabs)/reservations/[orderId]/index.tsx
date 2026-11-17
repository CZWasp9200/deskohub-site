import { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Stack, useLocalSearchParams } from "expo-router";
import { OrderStatusScreen } from "../../../../../src/account/reservations/order-status-screen";
import { statusVisitOf } from "../../../../../src/account/reservations/status-refresh-rules";
import { useAppLocale } from "../../../../../src/i18n/locale-context";
import { m } from "../../../../../src/i18n/messages";
import { renderClosingStackHeader } from "../../../../../src/ui/navigation";

export default function ReservationStatusRoute() {
  // Only `after` matters; other params (such as a preview's bypass) are ignored.
  const { orderId, after } = useLocalSearchParams<{
    orderId: string;
    after?: string;
  }>();
  const locale = useAppLocale();
  const visit = statusVisitOf(after);
  return (
    <>
      {/* Straight after payment the booking closes to the Reservations list
          below it (`leaveCheckout`), never back into checkout. */}
      {visit === "after-payment" && (
        <Stack.Screen
          options={{
            title: m.reservations_your_booking({}, { locale }),
            header: renderClosingStackHeader,
          }}
        />
      )}
      <OrderStatusScreen
        key={orderId}
        orderId={CustomerReservationOrderId.make(orderId)}
        visit={visit}
      />
    </>
  );
}
