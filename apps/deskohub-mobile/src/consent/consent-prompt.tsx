import { openBrowserAsync } from "expo-web-browser";
import ChartColumn from "lucide-react-native/icons/chart-column";
import { Pressable, StyleSheet, View } from "react-native";
import { legalDocumentUrl } from "../account/legal/legal-documents";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { BottomSheet } from "../ui/bottom-sheet";
import { Button, ButtonRow } from "../ui/controls";
import { Icon } from "../ui/icon";
import { Text } from "../ui/text";
import { space } from "../ui/tokens";

/**
 * The site's cookie policy, which says what the app measures. The auth
 * client that names the site loads on the press, not with the analytics
 * root that mounts this prompt.
 */
const showWhatWeMeasure = () => {
  void import("../auth/auth-client")
    .then(({ apiOrigin }) =>
      openBrowserAsync(legalDocumentUrl("cookies", apiOrigin))
    )
    .catch(() => undefined);
};

/**
 * Asks once for analytics consent, in a bottom sheet over the first screen.
 * Both answers carry the same weight, like the site's banner. Dismissing the
 * sheet answers nothing: analytics stays off.
 */
export function ConsentPrompt({
  onAccept,
  onDecline,
  onDismiss,
}: {
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly onDismiss: () => void;
}) {
  const locale = useAppLocale();

  return (
    <BottomSheet visible onDismiss={onDismiss}>
      <View style={styles.content}>
        <View style={styles.question}>
          <Icon icon={ChartColumn} size={24} />
          <Text variant="title" role="heading" style={styles.message}>
            {m.consent_prompt_message({}, { locale })}
          </Text>
        </View>
        <Pressable
          role="link"
          onPress={showWhatWeMeasure}
          hitSlop={{ top: 12, bottom: 12 }}
          style={styles.link}
        >
          <Text variant="subhead" tone="action" style={styles.linkText}>
            {m.consent_what_we_measure({}, { locale })}
          </Text>
        </Pressable>
        <View style={styles.answers}>
          <ButtonRow>
            <Button
              variant="secondary"
              label={m.consent_prompt_decline({}, { locale })}
              onPress={onDecline}
            />
            <Button
              variant="secondary"
              label={m.consent_prompt_accept({}, { locale })}
              onPress={onAccept}
            />
          </ButtonRow>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: space.lg,
    paddingHorizontal: space.xs,
    paddingTop: space.md,
  },
  question: { alignItems: "center", flexDirection: "row", gap: 10 },
  message: { flexShrink: 1 },
  link: { alignSelf: "center", marginTop: 6 },
  linkText: { textDecorationLine: "underline" },
  answers: { marginTop: space.xl },
});
