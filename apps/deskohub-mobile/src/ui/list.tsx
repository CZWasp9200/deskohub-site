import ChevronRight from "lucide-react-native/icons/chevron-right";
import ExternalLink from "lucide-react-native/icons/external-link";
import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconComponent } from "./icon";
import { listDividerInset, listRowLayout } from "./list-row-layout";
import {
  type ListRowKind,
  listRowAccessibleLabel,
  listRowPresentation,
} from "./list-row-presentation";
import { Text } from "./text";
import { color, radius, shadow, space } from "./tokens";

/**
 * The heading above a group of rows, outside the card at the screen's left
 * edge: 24 above it, 8 when it is the first thing on the screen, with an
 * optional line of description under the title.
 */
export function SectionHeader({
  title,
  description,
  first = false,
}: {
  readonly title: string;
  readonly description?: string;
  readonly first?: boolean;
}) {
  return (
    <View style={[styles.sectionHeader, first && styles.firstSectionHeader]}>
      <Text variant="subhead" role="heading" aria-level={2}>
        {title}
      </Text>
      {description !== undefined && (
        <Text variant="bodySmall">{description}</Text>
      )}
    </View>
  );
}

/** Whether a row in a group draws an icon tile, read from its `icon` prop. */
const drawsIcon = (row: ReactNode) =>
  isValidElement<{ readonly icon?: unknown }>(row) && !!row.props.icon;

/**
 * Rows on one white card, radius 16 with the warm outline, separated by
 * dividers that start under the text (past the icon tile when a row has
 * one). The group draws the dividers, so any row that follows the list row
 * layout fits, such as a switch or checkbox row.
 */
export function ListGroup({ children }: { readonly children: ReactNode }) {
  // `Children.toArray` keys every row and drops `false` from conditional rows.
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={styles.group}>
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 && (
            <View
              aria-hidden
              style={[
                styles.divider,
                {
                  marginStart: listDividerInset({
                    above: drawsIcon(rows[index - 1]),
                    below: drawsIcon(row),
                  }),
                },
              ]}
            />
          )}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** The tile behind a row's icon: neutral, destructive or confirmed. */
export type ListRowIconTone = "neutral" | "danger" | "positive";

const iconTileColors = {
  neutral: { background: color.sunken, ink: color.navy },
  danger: { background: color.dangerTint, ink: color.dangerInk },
  positive: { background: color.positiveTint, ink: color.positiveInk },
} as const satisfies Record<
  ListRowIconTone,
  { readonly background: string; readonly ink: string }
>;

/**
 * What ends a row: a chevron, the external-link icon for a page that opens
 * outside the app, nothing, or the caller's own content such as a badge.
 */
export type ListRowTrailing = "chevron" | "external" | "none" | ReactNode;

/**
 * One row of a list, 56 tall (72 with a description). Without `onPress` it
 * only shows content. A `navigation` row (the default) is a link that opens
 * another screen and ends in a chevron; an `action` row is a button that acts
 * in place. The whole row is the target and tints while pressed.
 * `destructive` marks an irreversible action, such as deleting the account.
 *
 * A `value` shares the label's line when both fit and moves under the label
 * when they don't; `wrapValue` keeps a long value, such as a date range,
 * beside the label instead, wrapping in up to two thirds of the row. Nothing
 * is cut.
 *
 * The row reads as one label, value and description. A custom `trailing`
 * node is read as part of the row, after its text.
 */
export function ListRow({
  label,
  description,
  value,
  icon,
  iconTone,
  trailing,
  onPress,
  kind = "navigation",
  destructive = false,
  disabled = false,
  wrapValue = false,
}: {
  readonly label: string;
  readonly description?: string;
  readonly value?: string;
  /** A Lucide icon in a tile before the label. */
  readonly icon?: IconComponent;
  /** The icon tile's tone; a destructive row's is `danger` by default. */
  readonly iconTone?: ListRowIconTone;
  /** What ends the row; a chevron by default when it navigates. */
  readonly trailing?: ListRowTrailing;
  readonly onPress?: () => void;
  readonly kind?: ListRowKind;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly wrapValue?: boolean;
}) {
  const { role, chevron } = listRowPresentation({
    pressable: onPress !== undefined,
    kind,
  });
  const tile = iconTileColors[iconTone ?? (destructive ? "danger" : "neutral")];
  const end = trailing ?? (chevron ? "chevron" : "none");
  const content = (
    <>
      {icon && (
        <View
          style={[listRowLayout.iconTile, { backgroundColor: tile.background }]}
        >
          <Icon
            icon={icon}
            size={20}
            color={disabled ? color.disabledInk : tile.ink}
          />
        </View>
      )}
      <View style={[styles.body, wrapValue && styles.bodyBeside]}>
        <View style={listRowLayout.text}>
          <Text
            variant="bodyStrong"
            tone={destructive ? "danger" : "default"}
            style={disabled && styles.disabledText}
          >
            {label}
          </Text>
          {description !== undefined && (
            <Text variant="bodySmall">{description}</Text>
          )}
        </View>
        {value !== undefined && (
          <Text
            variant="rowValue"
            tone="muted"
            style={wrapValue && styles.valueBeside}
          >
            {value}
          </Text>
        )}
      </View>
      {trailingContent(end)}
    </>
  );
  const ownTrailing = end !== "chevron" && end !== "external" && end !== "none";
  // A custom trailing node, such as a badge, is read from the row's content.
  const accessibleLabel = ownTrailing
    ? undefined
    : listRowAccessibleLabel({ label, value, description });
  const rowStyle = [
    listRowLayout.row,
    description !== undefined && listRowLayout.withDescription,
  ];

  if (onPress === undefined) {
    return (
      <View accessible aria-label={accessibleLabel} style={rowStyle}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      role={role}
      aria-label={accessibleLabel}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        rowStyle,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

const trailingContent = (end: ListRowTrailing) => {
  if (end === "chevron") {
    return <Icon icon={ChevronRight} size={20} color={color.ink3} />;
  }
  if (end === "external") {
    return <Icon icon={ExternalLink} size={18} color={color.ink3} />;
  }
  if (end === "none") return null;
  return <View style={styles.trailing}>{end}</View>;
};

const styles = StyleSheet.create({
  sectionHeader: {
    gap: space.xxs,
    paddingBottom: space.sm,
    paddingTop: space.xxl,
  },
  firstSectionHeader: { paddingTop: space.sm },
  group: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 1,
    overflow: "hidden",
    ...shadow.group,
  },
  divider: { backgroundColor: color.divider, height: 1 },
  // The label column and the value wrap onto two lines when they can't
  // share one, so the value lands under the label.
  body: {
    alignItems: "center",
    columnGap: space.md,
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
    flexWrap: "wrap",
    minWidth: 0,
  },
  bodyBeside: { flexWrap: "nowrap" },
  // Leaves the label at least half the row; a badge inside wraps instead.
  trailing: { maxWidth: "50%" },
  valueBeside: { flexShrink: 1, maxWidth: "65%", textAlign: "right" },
  pressed: { backgroundColor: color.pressed },
  disabledText: { color: color.disabledInk },
});
