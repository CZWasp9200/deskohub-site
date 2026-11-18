import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { useRouter } from "expo-router";
import KeyRound from "lucide-react-native/icons/key-round";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Button } from "../../ui/controls";

/**
 * The reservation's main action everywhere it shows: open its access PIN.
 * One primary button with the key, as the website's PIN button.
 */
export function AccessPinButton({
  orderId,
}: {
  readonly orderId: CustomerReservationOrderId;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  return (
    <Button
      icon={KeyRound}
      label={m.reservationShowPinCode({}, { locale })}
      onPress={() =>
        router.push({
          pathname: "/reservations/[orderId]/access",
          params: { orderId },
        })
      }
    />
  );
}
