import Check from "lucide-react-native/icons/check";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import X from "lucide-react-native/icons/x";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Badge, type BadgeTone } from "../../ui/badge";
import { Icon, type IconComponent } from "../../ui/icon";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { Skeleton, SkeletonGroup } from "../../ui/skeleton";
import { Text } from "../../ui/text";
import { brandText, color, radius, shadow, space } from "../../ui/tokens";
import type { DateTileParts } from "./booking-time";

// The booking ticket of boards 21–23 and 36 (`.bk-ticket` in the proposal's
// dk.py): what is booked above a perforation, and under it the steps or the
// one action for the booking's state. The list and the booking view share it.

/** How the booking's date tile reads: navy when booked, quieter otherwise. */
export type DateTileTone = "strong" | "soft" | "dim";

/** A booking's day as a tile: weekday, day of the month, month. */
export function DateTile({
  parts,
  tone = "strong",
  compact = false,
}: {
  readonly parts: DateTileParts;
  readonly tone?: DateTileTone;
  /** The smaller tile of a list row. */
  readonly compact?: boolean;
}) {
  const look = tileLooks[tone];
  return (
    <View
      aria-hidden
      style={[
        styles.tile,
        compact && styles.tileCompact,
        { backgroundColor: look.background },
      ]}
    >
      <Text style={[styles.tileSmall, { color: look.muted }]}>
        {parts.weekday}
      </Text>
      <Text
        numeric
        style={[
          styles.tileDay,
          compact && styles.tileDayCompact,
          { color: look.ink },
        ]}
      >
        {parts.day}
      </Text>
      <Text style={[styles.tileSmall, { color: look.muted }]}>
        {parts.month}
      </Text>
    </View>
  );
}

const tileLooks = {
  strong: {
    background: color.navy,
    ink: color.white,
    muted: color.onNavyMuted,
  },
  soft: { background: color.sunken, ink: color.navy, muted: color.ink2 },
  dim: { background: color.sunken, ink: color.ink2, muted: color.ink3 },
} as const satisfies Record<
  DateTileTone,
  { readonly background: string; readonly ink: string; readonly muted: string }
>;

/** The reason a booking shows instead of its countdown, and its colour. */
export type TicketReasonTone = "danger" | "neutral" | "warning";

const reasonInk = {
  danger: color.dangerInk,
  neutral: color.ink2,
  warning: color.warningInk,
} as const satisfies Record<TicketReasonTone, string>;

/** The left of the ticket's header: a countdown, or a reason. */
export type TicketLead =
  | { readonly kind: "countdown"; readonly text: string }
  | {
      readonly kind: "reason";
      readonly text: string;
      readonly tone: TicketReasonTone;
    };

export interface TicketBadge {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly icon?: IconComponent;
}

/** One line under the title: an icon and its text, such as the address. */
export interface TicketMetaLine {
  readonly key: string;
  readonly icon: IconComponent;
  readonly text: string;
  /** What the line covers, in small type under it. */
  readonly detail?: string;
}

/**
 * The ticket: header (lead and status badge), date tile, title and time,
 * the meta lines, and `children` under the perforation when given. `stub`
 * lays the part under the perforation out as a column (steps, a full-width
 * action) or as a row (the list's access line).
 */
export function BookingTicket({
  lead,
  badge,
  date,
  dateTone = "strong",
  title,
  lines,
  meta = [],
  stub = "column",
  onPress,
  children,
}: {
  readonly lead: TicketLead | undefined;
  readonly badge: TicketBadge;
  readonly date: DateTileParts | undefined;
  readonly dateTone?: DateTileTone;
  readonly title: string;
  /** Lines under the title, such as the time and the place. */
  readonly lines: ReadonlyArray<string>;
  readonly meta?: ReadonlyArray<TicketMetaLine>;
  readonly stub?: "column" | "row";
  /** Opens the booking: the part above the perforation is its link. */
  readonly onPress?: () => void;
  readonly children?: ReactNode;
}) {
  const top = (
    <>
      <View style={styles.header}>
        {lead !== undefined && <TicketLeadView lead={lead} />}
        <View style={styles.badge}>
          <Badge label={badge.label} tone={badge.tone} icon={badge.icon} />
        </View>
      </View>
      <View style={styles.what}>
        {date !== undefined && <DateTile parts={date} tone={dateTone} />}
        <View style={styles.whatText}>
          <Text variant="headline">{title}</Text>
          {lines.map((line) => (
            <Text key={line} variant="bodySmall">
              {line}
            </Text>
          ))}
        </View>
      </View>
      {meta.length > 0 && (
        <View style={styles.meta}>
          {meta.map((line) => (
            <View key={line.key} style={styles.metaLine}>
              <View style={styles.metaIcon}>
                <Icon icon={line.icon} size={18} color={color.ink2} />
              </View>
              <View style={styles.flex}>
                <Text variant="bodySmall" tone="default">
                  {line.text}
                </Text>
                {line.detail !== undefined && (
                  <Text variant="hint">{line.detail}</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </>
  );
  return (
    <View style={styles.ticket}>
      {onPress === undefined ? (
        <View style={styles.top}>{top}</View>
      ) : (
        <Pressable
          role="link"
          onPress={onPress}
          style={({ pressed }) => [
            styles.top,
            styles.topLink,
            pressed && styles.topPressed,
          ]}
        >
          {top}
        </Pressable>
      )}
      {children !== undefined && (
        <>
          <Perforation />
          <View style={stub === "column" ? styles.stubColumn : styles.stubRow}>
            {children}
          </View>
        </>
      )}
    </View>
  );
}

function TicketLeadView({ lead }: { readonly lead: TicketLead }) {
  if (lead.kind === "countdown") {
    return (
      <Text style={[styles.lead, { color: color.ink2 }]}>{lead.text}</Text>
    );
  }
  const ink = reasonInk[lead.tone];
  return (
    <View style={styles.reason}>
      <Icon icon={TriangleAlert} size={16} color={ink} />
      <Text style={[styles.lead, styles.flexShrink, { color: ink }]}>
        {lead.text}
      </Text>
    </View>
  );
}

/**
 * The dashed tear line between the booking and its stub, with a half notch
 * cut into each side.
 */
function Perforation() {
  return (
    <View aria-hidden style={styles.perforation}>
      <View style={[styles.notch, styles.notchStart]} />
      {/* Android draws a dashed border only on all sides: clip a dashed box. */}
      <View style={styles.dashClip}>
        <View style={styles.dash} />
      </View>
      <View style={[styles.notch, styles.notchEnd]} />
    </View>
  );
}

/** Where a step is. */
export type StepState = "done" | "running" | "todo" | "warning" | "failed";

export interface BookingStepView {
  readonly key: string;
  readonly state: StepState;
  readonly title: string;
  readonly description?: string;
}

/** The steps under the perforation while a booking is under way. */
export function BookingSteps({
  steps,
}: {
  readonly steps: ReadonlyArray<BookingStepView>;
}) {
  return (
    <View role="list" style={styles.steps}>
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <View
            key={step.key}
            role="listitem"
            style={[styles.step, last && styles.stepLast]}
          >
            {!last && (
              <View
                aria-hidden
                style={[
                  styles.connector,
                  step.state === "done" && styles.connectorDone,
                ]}
              />
            )}
            <StepDot state={step.state} />
            <View style={styles.flex}>
              <Text
                style={[
                  styles.stepTitle,
                  step.state === "todo" && styles.stepTitleTodo,
                ]}
              >
                {step.title}
              </Text>
              {step.description !== undefined && (
                <Text variant="bodySmall">{step.description}</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const stepGlyphs = {
  done: { icon: Check, background: color.positiveInk, ink: color.white },
  warning: {
    icon: TriangleAlert,
    background: color.warning,
    ink: color.onWarning,
  },
  failed: { icon: X, background: color.danger, ink: color.white },
} as const;

function StepDot({ state }: { readonly state: StepState }) {
  if (state === "running") {
    return (
      <View aria-hidden style={[styles.dot, styles.dotRunning]}>
        <LoadingIndicator size="inline" tone="brand" />
      </View>
    );
  }
  if (state === "todo") {
    return <View aria-hidden style={[styles.dot, styles.dotTodo]} />;
  }
  const glyph = stepGlyphs[state];
  return (
    <View
      aria-hidden
      style={[styles.dot, { backgroundColor: glyph.background }]}
    >
      <Icon icon={glyph.icon} size={14} color={glyph.ink} />
    </View>
  );
}

/** The ticket while its booking loads, in its final layout. */
export function BookingTicketSkeleton({
  label,
  stub,
}: {
  readonly label: string;
  /** What stands under the perforation: a button, or the list's access row. */
  readonly stub: "button" | "row";
}) {
  return (
    <SkeletonGroup label={label}>
      <View style={styles.ticket}>
        <View style={styles.top}>
          <View style={styles.header}>
            <Skeleton width={72} height={14} radius={7} />
            <View style={styles.badge}>
              <Skeleton width={84} height={24} radius={radius.badge} />
            </View>
          </View>
          <View style={styles.what}>
            <Skeleton width={56} height={64} radius={14} />
            <View style={[styles.whatText, styles.skeletonText]}>
              <Skeleton width="60%" height={16} />
              <Skeleton width="40%" height={12} radius={6} />
            </View>
          </View>
          {stub === "button" && (
            <View style={styles.meta}>
              <Skeleton width="70%" height={12} radius={6} />
              <Skeleton width="30%" height={12} radius={6} />
              <Skeleton width="50%" height={12} radius={6} />
            </View>
          )}
        </View>
        <Perforation />
        {stub === "button" ? (
          <View style={styles.stubColumn}>
            <Skeleton width="100%" height={48} radius={24} />
          </View>
        ) : (
          <View style={styles.stubRow}>
            <Skeleton width={40} height={40} radius={radius.tile} />
            <View style={[styles.flex, styles.skeletonText]}>
              <Skeleton width="50%" height={12} radius={6} />
              <Skeleton width="34%" height={10} radius={5} />
            </View>
          </View>
        )}
      </View>
    </SkeletonGroup>
  );
}

const notchSize = 16;

const styles = StyleSheet.create({
  ticket: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: 20,
    borderWidth: 1,
    ...shadow.card,
  },
  top: { paddingBottom: space.lg, paddingHorizontal: 18, paddingTop: 18 },
  topLink: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  topPressed: { backgroundColor: color.pressed },
  header: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: space.sm,
    rowGap: 6,
    justifyContent: "space-between",
    marginBottom: space.md,
    minHeight: 24,
  },
  lead: brandText(13, 18, 600),
  reason: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 6,
  },
  badge: { marginLeft: "auto" },
  what: { alignItems: "flex-start", flexDirection: "row", gap: 14 },
  whatText: { flex: 1, gap: space.xxs, minWidth: 0 },
  skeletonText: { gap: space.sm, paddingTop: space.xs },
  tile: {
    alignItems: "center",
    borderRadius: 14,
    minWidth: 56,
    paddingBottom: space.sm,
    paddingHorizontal: 6,
    paddingTop: 7,
  },
  // At large font sizes the tile grows with its text rather than cutting it.
  tileCompact: { minWidth: 52, paddingBottom: 7, paddingTop: 6 },
  tileSmall: brandText(12, 14, 600),
  tileDay: brandText(24, 28, 700),
  tileDayCompact: brandText(20, 24, 700),
  meta: { gap: space.sm, marginTop: 14 },
  metaLine: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  metaIcon: { marginTop: 1 },
  flex: { flex: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  perforation: {
    alignItems: "center",
    flexDirection: "row",
    height: notchSize,
    marginVertical: -notchSize / 2,
  },
  notch: {
    backgroundColor: color.paper,
    borderColor: color.line,
    borderWidth: 1,
    height: notchSize,
    width: notchSize / 2,
  },
  notchStart: {
    borderBottomRightRadius: notchSize / 2,
    borderLeftWidth: 0,
    borderTopRightRadius: notchSize / 2,
    marginLeft: -1,
  },
  notchEnd: {
    borderBottomLeftRadius: notchSize / 2,
    borderRightWidth: 0,
    borderTopLeftRadius: notchSize / 2,
    marginRight: -1,
  },
  dashClip: {
    flex: 1,
    height: 1.5,
    marginHorizontal: 18 - notchSize / 2,
    overflow: "hidden",
  },
  dash: {
    borderColor: color.perforation,
    borderStyle: "dashed",
    borderWidth: 1.5,
    height: 4,
  },
  stubColumn: {
    gap: space.md,
    paddingBottom: 18,
    paddingHorizontal: 18,
    paddingTop: space.lg,
  },
  // At large font sizes its action wraps under the text.
  stubRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
    paddingBottom: space.lg,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  steps: {},
  step: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.md,
    paddingBottom: space.lg,
  },
  stepLast: { paddingBottom: 0 },
  connector: {
    backgroundColor: color.line,
    bottom: 2,
    left: 11,
    position: "absolute",
    top: 26,
    width: 2,
  },
  connectorDone: { backgroundColor: color.stepConnectorDone },
  dot: {
    alignItems: "center",
    borderRadius: 12,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  dotRunning: { backgroundColor: color.actionTint },
  dotTodo: {
    backgroundColor: color.surface,
    borderColor: color.outline,
    borderWidth: 2,
  },
  stepTitle: { ...brandText(15, 22, 600), color: color.navy },
  stepTitleTodo: { ...brandText(15, 22, 500), color: color.ink2 },
});
