import { Option } from "effect";
import { useAppLocale } from "../../i18n/locale-context";
import { Notice } from "../../ui/notice";
import type { CheckoutRestartReason } from "../checkout/booking-problem";
import { restartMessage, restartTitle } from "./booking-family-copy";

/**
 * Why checkout started the booking over, at the top of a family screen, as
 * a warning with the choices kept below it. It stays mounted while there's
 * no reason, so each one is announced.
 */
export function RestartNotice({
  reason,
}: {
  readonly reason: Option.Option<CheckoutRestartReason>;
}) {
  const locale = useAppLocale();
  const restart = Option.getOrUndefined(reason);
  return (
    <Notice
      tone="warning"
      title={restart === undefined ? undefined : restartTitle(restart, locale)}
      message={
        restart === undefined ? undefined : restartMessage(restart, locale)
      }
    />
  );
}
