import Bot from "lucide-react-native/icons/bot";
import Check from "lucide-react-native/icons/check";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { Button } from "../../ui/controls";
import { Icon } from "../../ui/icon";
import { ListRow } from "../../ui/list";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";
import type { AssistantRow, AssistantScope } from "./connected-assistants";

const scopeLabel = (scope: AssistantScope, locale: AppLocale) =>
  ({
    "offerings:read": m.assistants_scope_offerings_read,
    "reservations:read": m.assistants_scope_reservations_read,
    "reservations:create": m.assistants_scope_reservations_create,
    offline_access: m.assistants_scope_offline_access,
  })[scope]({}, { locale });

const detailsText = (row: AssistantRow, locale: AppLocale) => {
  const { details } = row;
  switch (details.kind) {
    case "host":
      return m.assistants_details(
        { host: details.host, date: details.date },
        { locale }
      );
    case "date":
      return m.assistants_connected_on({ date: details.date }, { locale });
    case "none":
      return undefined;
  }
};

/**
 * One connected assistant: who it is, where it comes from and since when,
 * what it may do, and its own Disconnect. Administrator access is flagged in
 * the warning colour, only when the server says the assistant has it.
 */
export function AssistantConnectionRow({
  row,
  locale,
  inlineActions = false,
  onDisconnect,
}: {
  readonly row: AssistantRow;
  readonly locale: AppLocale;
  readonly inlineActions?: boolean;
  readonly onDisconnect: () => void;
}) {
  const name = row.name ?? m.assistants_unnamed({}, { locale });
  return (
    <ListRow
      icon={Bot}
      label={name}
      description={detailsText(row, locale)}
      below={
        <View style={inlineActions && styles.inlineActions}>
          {(row.scopes.length > 0 || row.administration) && (
            <View
              role="list"
              aria-label={m.assistants_scopes_label({ name }, { locale })}
              style={[styles.scopes, inlineActions && styles.inlineScopes]}
            >
              {row.scopes.map((scope) => (
                <View key={scope} role="listitem" style={styles.scope}>
                  <Icon icon={Check} size={16} color={color.positiveInk} />
                  <Text variant="bodySmall" style={styles.scopeLabel}>
                    {scopeLabel(scope, locale)}
                  </Text>
                </View>
              ))}
              {row.administration && (
                <View role="listitem" style={styles.scope}>
                  <Icon
                    icon={TriangleAlert}
                    size={16}
                    color={color.warningInk}
                  />
                  <Text
                    variant="bodySmall"
                    style={[styles.scopeLabel, styles.administration]}
                  >
                    {m.assistants_administration({}, { locale })}
                  </Text>
                </View>
              )}
            </View>
          )}
          <View
            style={[
              styles.disconnect,
              inlineActions && styles.inlineDisconnect,
            ]}
          >
            <Button
              variant="secondary"
              size="small"
              width="content"
              label={m.assistants_disconnect({}, { locale })}
              accessibilityLabel={m.assistants_disconnect_label(
                { name },
                { locale }
              )}
              onPress={onDisconnect}
            />
          </View>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  inlineActions: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: space.md,
    justifyContent: "flex-end",
  },
  scopes: { gap: space.xs, marginTop: space.sm + space.xxs },
  inlineScopes: { flex: 1, minWidth: 0 },
  scope: { flexDirection: "row", gap: space.sm, paddingTop: space.xxs },
  scopeLabel: { color: color.navy, flex: 1, marginTop: -space.xxs },
  administration: { color: color.warningInk, fontWeight: "600" },
  disconnect: { alignItems: "flex-start", marginTop: space.md },
  inlineDisconnect: { flexShrink: 1, maxWidth: "45%", marginTop: space.xs },
});
