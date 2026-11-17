import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import Mail from "lucide-react-native/icons/mail";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Trash2 from "lucide-react-native/icons/trash-2";
import User from "lucide-react-native/icons/user";
import WifiOff from "lucide-react-native/icons/wifi-off";
import { apiOrigin } from "../auth/auth-client";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { contactPageUrl } from "../routing/site-page";
import { Button } from "../ui/controls";
import { GateCard } from "../ui/gate-card";
import { accountSectionHref, type TabGate } from "./account-gating";

/** Opens the contact form; where no browser is available there is nothing else to open. */
const contactUs = () =>
  void openBrowserAsync(contactPageUrl(apiOrigin)).catch(() => undefined);

/**
 * A tab root's gate card (see `tabGate`): "Complete your profile", which
 * opens the profile form; Book's cards while the account is being deleted
 * or support must check it, with Contact us; and the account that didn't
 * load, with Try again (`onRetry`).
 */
export function TabGateCard({
  gate,
  onRetry,
}: {
  readonly gate: TabGate;
  readonly onRetry?: () => void;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  return {
    profile: () => (
      <GateCard
        icon={User}
        tone="action"
        title={m.account_gate_profile_title({}, { locale })}
        body={m.account_gate_profile_body({}, { locale })}
      >
        <Button
          label={m.account_section_complete({}, { locale })}
          onPress={() => router.push(accountSectionHref.complete)}
        />
      </GateCard>
    ),
    deletion: () => (
      <GateCard
        icon={Trash2}
        tone="danger"
        title={m.booking_gate_deletion_title({}, { locale })}
        body={m.booking_gate_deletion_body({}, { locale })}
      >
        <Button
          variant="quiet"
          icon={Mail}
          label={m.account_contact_us({}, { locale })}
          onPress={contactUs}
        />
      </GateCard>
    ),
    support: () => (
      <GateCard
        icon={Mail}
        tone="action"
        title={m.booking_gate_support_title({}, { locale })}
        body={m.booking_gate_support_body({}, { locale })}
      >
        <Button
          icon={Mail}
          label={m.account_contact_us({}, { locale })}
          onPress={contactUs}
        />
      </GateCard>
    ),
    unavailable: () => (
      <GateCard
        icon={WifiOff}
        title={m.booking_gate_unavailable_title({}, { locale })}
        body={m.booking_gate_unavailable_body({}, { locale })}
      >
        {onRetry !== undefined && (
          <Button
            variant="secondary"
            icon={RotateCcw}
            label={m.booking_checkout_retry({}, { locale })}
            onPress={onRetry}
          />
        )}
      </GateCard>
    ),
  }[gate]();
}
