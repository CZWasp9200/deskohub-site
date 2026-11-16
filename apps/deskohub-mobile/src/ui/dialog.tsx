import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconComponent } from "./icon";
import { Text } from "./text";
import { color, radius, shadow, space } from "./tokens";

/**
 * A white card over the navy scrim that asks one question. Its `actions`
 * stack full width, the safe action first (a flow whose board puts the
 * consequential action on top passes them in that order). The `header`,
 * title, body and `children`
 * scroll when they're taller than the screen, so the actions stay in view.
 * The back button and a tap on the scrim call `onDismiss`.
 */
export function Dialog({
  visible,
  title,
  titleIcon,
  header,
  body,
  onDismiss,
  children,
  actions,
  role = "dialog",
  busy = false,
}: {
  readonly visible: boolean;
  readonly title: string;
  /** A Lucide icon on the title's line, before it. */
  readonly titleIcon?: IconComponent;
  /** Content above the title, such as a badge with what just happened. */
  readonly header?: ReactNode;
  readonly body?: string;
  readonly onDismiss: () => void;
  /** Content between the body and the actions, such as a field. */
  readonly children?: ReactNode;
  /** The buttons, safe action first. */
  readonly actions: ReactNode;
  /** `alertdialog` when the dialog interrupts to confirm a consequential step. */
  readonly role?: "dialog" | "alertdialog";
  /** An action is running; assistive tech hears the dialog as busy. */
  readonly busy?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const heading = (
    <Text
      variant="dialogTitle"
      role="heading"
      style={titleIcon === undefined ? undefined : styles.titleText}
    >
      {title}
    </Text>
  );
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onDismiss}
    >
      <View
        style={[
          styles.scrim,
          {
            paddingBottom: insets.bottom + space.xxl,
            paddingTop: insets.top + space.xxl,
          },
        ]}
      >
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={onDismiss}
          style={StyleSheet.absoluteFill}
        />
        <View
          role={role}
          aria-modal
          aria-label={title}
          aria-busy={busy}
          accessibilityViewIsModal
          style={styles.card}
        >
          <ScrollView style={styles.scroll} contentContainerStyle={styles.copy}>
            {header}
            {titleIcon === undefined ? (
              heading
            ) : (
              <View style={styles.titleLine}>
                <Icon icon={titleIcon} size={24} color={color.navy} />
                {heading}
              </View>
            )}
            {body !== undefined && (
              <Text variant="lead" tone="muted">
                {body}
              </Text>
            )}
            {children}
          </ScrollView>
          <View style={styles.actions}>{actions}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    alignItems: "center",
    backgroundColor: color.scrim,
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: space.xxl,
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.overlay,
    gap: space.md,
    maxHeight: "100%",
    maxWidth: 420,
    padding: space.xxl,
    width: "100%",
    ...shadow.dialog,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  copy: { alignItems: "stretch", gap: space.md },
  titleLine: { alignItems: "center", flexDirection: "row", gap: 10 },
  titleText: { flexShrink: 1 },
  actions: { gap: space.sm, marginTop: space.md },
});
