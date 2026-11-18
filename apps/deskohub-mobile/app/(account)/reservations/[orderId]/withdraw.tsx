import { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { useLocalSearchParams } from "expo-router";
import { WithdrawalScreen } from "../../../../src/account/reservations/withdrawal-screen";

export default function ReservationWithdrawRoute() {
  const { orderId, reference } = useLocalSearchParams<{
    orderId: string;
    reference?: string;
  }>();
  return (
    <WithdrawalScreen
      orderId={CustomerReservationOrderId.make(orderId)}
      reference={reference ?? orderId}
    />
  );
}
