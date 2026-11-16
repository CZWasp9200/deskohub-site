import { useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import Mail from "lucide-react-native/icons/mail";
import Trash2 from "lucide-react-native/icons/trash-2";
import User from "lucide-react-native/icons/user";
import { apiOrigin } from "../auth/auth-client";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { contactPageUrl } from "../routing/site-page";
import { Button } from "../ui/controls";
import { GateCard } from "../ui/gate-card";
import { accountSectionHref, type TabGate } from "./account-gating";

/**
 * A tab root's gate card (see `tabGate`): "Complete your profile", which
 * opens the profile form, or Book's blocked card while the account is
 * being deleted, with Contact us.
 */
export function TabGateCard({ gate }: { readonly gate: TabGate }) {
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
          // Where no browser is available there is nothing else to open.
          onPress={() =>
            void openBrowserAsync(contactPageUrl(apiOrigin)).catch(
              () => undefined
            )
          }
        />
      </GateCard>
    ),
  }[gate]();
}
