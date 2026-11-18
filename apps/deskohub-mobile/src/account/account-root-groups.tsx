import { getLocaleDefinition } from "@deskohub/i18n/locale-registry";
import { Match } from "effect";
import { useRouter } from "expo-router";
import Bot from "lucide-react-native/icons/bot";
import Building from "lucide-react-native/icons/building";
import CreditCard from "lucide-react-native/icons/credit-card";
import FileText from "lucide-react-native/icons/file-text";
import Gift from "lucide-react-native/icons/gift";
import Languages from "lucide-react-native/icons/languages";
import Receipt from "lucide-react-native/icons/receipt";
import Shield from "lucide-react-native/icons/shield";
import Trash2 from "lucide-react-native/icons/trash-2";
import User from "lucide-react-native/icons/user";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Card } from "../ui/card";
import { Button } from "../ui/controls";
import { Icon, type IconComponent } from "../ui/icon";
import { ListGroup, ListRow, SectionHeader } from "../ui/list";
import { Text } from "../ui/text";
import { color, space } from "../ui/tokens";
import {
  type AccountDetailSection,
  accountSectionHref,
} from "./account-gating";
import type { AccountSectionMenu } from "./account-root";
import type {
  AccountGroup,
  AccountGroupHeading,
  AccountRowSection,
  AccountRowSubtitle,
} from "./account-root-model";
import { formatExactReferralDiscount } from "./referrals/referrals";

const rowIcon: Record<AccountRowSection, IconComponent> = {
  profile: User,
  security: Shield,
  assistants: Bot,
  billing: Building,
  "payment-methods": CreditCard,
  invoices: Receipt,
  language: Languages,
  referrals: Gift,
  legal: FileText,
  danger: Trash2,
};

const rowLabel = (section: AccountRowSection, locale: AppLocale) =>
  ({
    profile: m.account_section_profile,
    security: m.account_section_security,
    assistants: m.account_section_assistants,
    billing: m.account_section_billing,
    "payment-methods": m.account_section_payment_methods,
    invoices: m.account_section_invoices,
    language: m.account_section_language,
    referrals: m.account_section_referrals,
    legal: m.account_section_legal,
    danger: m.account_section_danger,
  })[section]({}, { locale });

const headingLabel = (heading: AccountGroupHeading, locale: AppLocale) =>
  ({
    "your-account": m.account_group_your_account,
    rewards: m.account_group_rewards,
    privacy: m.account_group_privacy,
    danger: m.account_group_danger,
  })[heading]({}, { locale });

/** A row's second line, worded for the locale. */
export const accountRowSubtitleText = (
  subtitle: AccountRowSubtitle,
  locale: AppLocale
): string =>
  Match.value(subtitle).pipe(
    Match.discriminatorsExhaustive("kind")({
      language: () => getLocaleDefinition(locale).nativeName,
      security: ({ passkeys }) => {
        if (passkeys === 0)
          return m.account_row_security_email_code({}, { locale });
        if (passkeys === 1)
          return m.account_row_security_one_passkey({}, { locale });
        return m.account_row_security_passkeys({ count: passkeys }, { locale });
      },
      assistants: ({ connected }) =>
        connected === 0
          ? m.account_row_assistants_none({}, { locale })
          : m.account_row_assistants_connected(
              { count: connected },
              { locale }
            ),
      billing: ({ invoicing }) =>
        ({
          none: m.account_row_billing_none,
          personal: m.account_row_billing_personal,
          business: m.account_row_billing_business,
        })[invoicing]({}, { locale }),
      "referral-offer": ({ discountPerInvitee }) =>
        m.account_row_referral_offer(
          {
            discount: formatExactReferralDiscount(discountPerInvitee, locale),
          },
          { locale }
        ),
      "referral-earned": ({ discount }) =>
        m.account_row_referral_earned(
          { discount: formatExactReferralDiscount(discount, locale) },
          { locale }
        ),
      legal: () => m.account_row_legal({}, { locale }),
    })
  );

// Payment methods has no screen yet, so its row only shows.
const opensScreen = (
  section: AccountRowSection
): section is AccountDetailSection => section !== "payment-methods";

/**
 * The Account tab's groups of section rows, each after its heading (the
 * first, on the masthead, has none), the Danger zone's row in crimson.
 */
export function AccountRootGroups({
  groups,
  menu,
}: {
  readonly groups: ReadonlyArray<AccountGroup>;
  readonly menu?: AccountSectionMenu;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  return (
    <View>
      {groups.map((group) => (
        <View key={group.heading ?? "first"}>
          {group.heading !== undefined && (
            <SectionHeader title={headingLabel(group.heading, locale)} />
          )}
          <ListGroup>
            {group.rows.map(({ section, subtitle }) => (
              <ListRow
                key={section}
                icon={rowIcon[section]}
                label={rowLabel(section, locale)}
                {...(subtitle !== undefined && {
                  description: accountRowSubtitleText(subtitle, locale),
                })}
                destructive={section === "danger"}
                {...(menu !== undefined && {
                  active: section === menu.activeSection,
                  trailing: "none" as const,
                })}
                {...(opensScreen(section) && {
                  onPress: () => {
                    if (menu === undefined) {
                      router.push(accountSectionHref[section]);
                    } else menu.openSection(section);
                  },
                })}
              />
            ))}
          </ListGroup>
        </View>
      ))}
    </View>
  );
}

/**
 * The Account tab's next step before the profile exists: a plain icon on
 * the title's line, one line on why, and the button to the profile form.
 */
export function ProfileCompletionCard() {
  const locale = useAppLocale();
  const router = useRouter();
  return (
    <Card>
      <View style={styles.card}>
        <View style={styles.titleLine}>
          <Icon icon={User} size={24} color={color.action} />
          <Text variant="headline" role="heading" style={styles.title}>
            {m.account_gate_profile_title({}, { locale })}
          </Text>
        </View>
        <Text variant="bodySmall">
          {m.account_gate_profile_body({}, { locale })}
        </Text>
        <Button
          label={m.account_section_complete({}, { locale })}
          onPress={() => router.push(accountSectionHref.complete)}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  titleLine: { alignItems: "center", flexDirection: "row", gap: space.md },
  title: { flex: 1 },
});
