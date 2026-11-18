import type {
  CustomerEstablishment,
  CustomerReservationAccess,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { DateTime, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  type NativeStackHeaderProps,
  Stack,
  useIsFocused,
  useRouter,
} from "expo-router";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import Check from "lucide-react-native/icons/check";
import Clock from "lucide-react-native/icons/clock";
import Copy from "lucide-react-native/icons/copy";
import DoorOpen from "lucide-react-native/icons/door-open";
import Lock from "lucide-react-native/icons/lock";
import Mail from "lucide-react-native/icons/mail";
import MapPin from "lucide-react-native/icons/map-pin";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import { Fragment, type ReactNode, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { bookKindHref, reservationsHref } from "../../booking/booking-routes";
import { AsyncView } from "../../customer-api/async-view";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Card } from "../../ui/card";
import { Button } from "../../ui/controls";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import { ListGroup, ListRow } from "../../ui/list";
import { useLiveRegionAnnouncement } from "../../ui/live-announcement";
import { StackHeader } from "../../ui/navigation";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Skeleton } from "../../ui/skeleton";
import { Text } from "../../ui/text";
import { color, radius, shadow, space, touchTarget } from "../../ui/tokens";
import { contentColumnWidth, useViewport, wideGutter } from "../../ui/viewport";
import {
  accessPinBox,
  accessPinBoxSize,
  accessPinGroups,
  wideAccessPinBox,
} from "./access-pin-groups";
import { useAccessPinView } from "./access-pin-view";
import {
  AccessScreenState,
  accessCountdownAtom,
  accessErrorMessage,
  accessHeaderTone,
  accessScreenStateOf,
  accessWindowKey,
  copyAddressAtom,
  copyPinWithFeedbackAtom,
  reservationAccessAtom,
  shownAccess,
  showsCopied,
} from "./access-screen-state";
import { type AccessWindow, accessWindowOf } from "./access-window";
import {
  type AccessChip,
  AccessWindowSpan,
  accessChipOf,
  accessChipText,
  accessDateTimeText,
  accessDaysText,
  accessWindowSpanOf,
} from "./access-window-text";
import { calendarShareAtom } from "./calendar-event";
import {
  establishmentAddressLines,
  establishmentAtom,
  establishmentCopyText,
  openDirections,
} from "./establishment";
import { openContactPage } from "./order-status-screen";
import { reservationOfOrderAtom } from "./order-ticket-view";
import { reservationProductTitle } from "./reservation-labels";
import type { ReservationListRow } from "./reservation-list-model";

/** The PIN the loading state holds room for: the shortest the lock issues. */
const placeholderGroups = accessPinGroups("0000000");

/**
 * The PIN's header in each tone: navy over the PIN, the paper canvas's
 * without one. Back from a PIN a link opened on a cold start, with nothing
 * behind it in the app, goes to the Reservations list.
 */
export const accessStackHeader = {
  navy: (props: NativeStackHeaderProps) => (
    <StackHeader {...props} tone="navy" backFallback={reservationsHref} />
  ),
  paper: (props: NativeStackHeaderProps) => (
    <StackHeader {...props} backFallback={reservationsHref} />
  ),
  paperWide: (props: NativeStackHeaderProps) => (
    <StackHeader
      {...props}
      backFallback={reservationsHref}
      contentWidth="wide"
    />
  ),
} as const;

export function ReservationAccessScreen({
  orderId,
}: {
  readonly orderId: CustomerReservationOrderId;
}) {
  const locale = useAppLocale();
  const { isExpanded, isWide } = useViewport();
  const read = shownAccess(useAtomValue(reservationAccessAtom(orderId)));
  const refresh = useAtomRefresh(reservationAccessAtom(orderId));
  const row = useAtomValue(reservationOfOrderAtom(orderId));
  const state = accessScreenStateOf(read);
  const refreshing = !AsyncResult.isInitial(read) && read.waiting;
  const headerTone = isWide ? "paper" : accessHeaderTone(state);
  const header = (
    <Stack.Screen
      options={{
        header: isExpanded
          ? accessStackHeader.paperWide
          : accessStackHeader[headerTone],
      }}
    />
  );
  if (AccessScreenState.$is("NoPin")(state)) {
    return (
      <>
        {header}
        <ScrollScreen refreshing={refreshing} onRefresh={refresh}>
          <NoPin orderId={orderId} />
        </ScrollScreen>
      </>
    );
  }
  const name = Option.getOrUndefined(
    Option.map(row, (found) => reservationProductTitle(found.product, locale))
  );
  return (
    <>
      {header}
      <AsyncView
        result={read}
        onRetry={refresh}
        errorMessage={(error) => accessErrorMessage(error, locale)}
        loading={
          <AccessLayout
            hero={
              <PinHero name={name}>
                <PinDigits groups={placeholderGroups} placeholder />
              </PinHero>
            }
          >
            <LoadingWindow />
          </AccessLayout>
        }
      >
        {(access) => (
          <AccessDetails
            orderId={orderId}
            access={access}
            name={name}
            row={row}
            refreshing={refreshing}
            onRefresh={refresh}
          />
        )}
      </AsyncView>
    </>
  );
}

function AccessLayout({
  hero,
  children,
  refreshing,
  onRefresh,
}: {
  readonly hero: ReactNode;
  readonly children: ReactNode;
  readonly refreshing?: boolean;
  readonly onRefresh?: () => void;
}) {
  const { isExpanded, isWide } = useViewport();
  return (
    <ScrollScreen
      contentWidth={isExpanded ? "wide" : "form"}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={[styles.accessLayout, isExpanded && styles.expandedLayout]}>
        <View
          style={[
            isExpanded && styles.expandedPane,
            !isWide && styles.compactHeroPane,
          ]}
        >
          {hero}
        </View>
        <View style={[styles.detailsPane, isExpanded && styles.expandedPane]}>
          {children}
        </View>
      </View>
    </ScrollScreen>
  );
}

function AccessDetails({
  orderId,
  access,
  name,
  row,
  refreshing,
  onRefresh,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly access: CustomerReservationAccess;
  readonly name: string | undefined;
  readonly row: Option.Option<ReservationListRow>;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  useAccessPinView(useIsFocused());
  const window = accessWindowOf(access);
  const windowState = Option.flatten(
    AsyncResult.value(
      useAtomValue(accessCountdownAtom(accessWindowKey(access)))
    )
  );
  const chip = Option.getOrUndefined(
    Option.map(Option.all([windowState, window]), ([state, parsed]) =>
      accessChipOf(state, parsed, DateTime.nowUnsafe())
    )
  );
  const ended = chip?._tag === "Ended";
  return (
    <AccessLayout
      refreshing={refreshing}
      onRefresh={onRefresh}
      hero={
        <PinHero
          name={name}
          chip={chip}
          action={
            ended ? undefined : <CopyPin orderId={orderId} code={access.code} />
          }
        >
          <PinDigits groups={accessPinGroups(access.code)} ended={ended} />
        </PinHero>
      }
    >
      {ended ? (
        <Button
          icon={RotateCcw}
          label={m.reservations_book_again({}, { locale })}
          onPress={() =>
            router.push(
              bookKindHref(
                Option.getOrUndefined(
                  Option.map(row, (found) => found.product.kind)
                )
              )
            )
          }
        />
      ) : (
        <WindowAndPlace orderId={orderId} window={window} row={row} />
      )}
    </AccessLayout>
  );
}

function PinHero({
  name,
  chip,
  action,
  children,
}: {
  readonly name: string | undefined;
  readonly chip?: AccessChip | undefined;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const locale = useAppLocale();
  const { isWide } = useViewport();
  const how = action !== undefined && (
    <View style={[styles.how, isWide && styles.wideHow]}>
      <Icon icon={DoorOpen} size={16} color={color.onNavyMuted} />
      <Text
        variant="hint"
        style={[styles.howText, isWide && styles.wideHowText]}
      >
        {m.reservations_access_how({}, { locale })}
      </Text>
    </View>
  );
  return (
    <View style={[styles.hero, isWide && styles.wideHero]}>
      <View style={isWide && styles.heroHeading}>
        <Text variant="lead" style={[styles.name, isWide && styles.wideName]}>
          {name ?? " "}
        </Text>
        {isWide && chip !== undefined && <StatusChip chip={chip} />}
      </View>
      {children}
      {!isWide && how}
      {!isWide && chip !== undefined && <StatusChip chip={chip} />}
      {action !== undefined && (
        <View style={isWide ? styles.heroFooter : styles.heroAction}>
          {isWide && how}
          {action}
        </View>
      )}
    </View>
  );
}

/**
 * The PIN in boxes, in groups: the boxes grow with the font size, and the
 * groups wrap whole when the PIN no longer fits one line
 * (`accessPinBoxSize`). Assistive tech
 * reads it one digit at a time; a placeholder holds the room while loading.
 */
function PinDigits({
  groups,
  ended = false,
  placeholder = false,
}: {
  readonly groups: ReadonlyArray<string>;
  readonly ended?: boolean;
  readonly placeholder?: boolean;
}) {
  const locale = useAppLocale();
  const { availableWidth, fontScale, isExpanded, isWide } = useViewport();
  const [measuredWidth, setMeasuredWidth] = useState<number>();
  const gutter = isWide ? wideGutter : space.gutter;
  const contentWidth = Math.min(
    availableWidth - 2 * gutter,
    contentColumnWidth[isExpanded ? "wide" : "form"]
  );
  // Bound the last measurement by the new pane width during live resize.
  const paneWidth = isExpanded ? (contentWidth - space.xxl) / 2 : contentWidth;
  const digitWidth = paneWidth - (isWide ? 2 * space.xxl : 0);
  const available = Math.min(digitWidth, measuredWidth ?? digitWidth);
  const size = accessPinBoxSize(groups, available, fontScale, isWide);
  const { digitGap, groupGap } = isWide ? wideAccessPinBox : accessPinBox;
  const box = {
    borderRadius: size.radius,
    height: size.height,
    width: size.width,
  };
  return (
    <View
      accessible={!placeholder}
      accessibilityRole={placeholder ? undefined : "text"}
      aria-hidden={placeholder}
      aria-label={
        placeholder
          ? undefined
          : m.reservations_access_code_label(
              { digits: Array.from(groups.join("")).join(" ") },
              { locale }
            )
      }
      onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
      style={[styles.pin, { columnGap: groupGap }, isWide && styles.widePin]}
    >
      {groups.map((group, groupIndex) => (
        <View
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          // biome-ignore lint/suspicious/noArrayIndexKey: PIN groups are positional.
          key={groupIndex}
          style={[styles.group, { columnGap: digitGap }]}
        >
          {Array.from(group).map((digit, index) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: PIN digits are positional and may repeat.
              key={index}
              style={[placeholder ? styles.boxEmpty : styles.box, box]}
            >
              {!placeholder && (
                <Text
                  numeric
                  allowFontScaling={false}
                  style={[
                    styles.digit,
                    {
                      fontSize: size.fontSize,
                      lineHeight: Math.round(size.fontSize * 1.1),
                    },
                    ended && styles.digitEnded,
                  ]}
                >
                  {digit}
                </Text>
              )}
              {/* Android draws no line-through in the brand face, so an
                  ended PIN's strike is its own line across the digit. */}
              {ended && !placeholder && <View style={styles.strike} />}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function CopyPin({
  orderId,
  code,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly code: string;
}) {
  const locale = useAppLocale();
  const { isWide } = useViewport();
  const [copied, copy] = useAtom(copyPinWithFeedbackAtom(orderId));
  const done = showsCopied(copied);
  const label = done
    ? m.reservations_access_copied({}, { locale })
    : m.reservations_access_copy({}, { locale });
  useLiveRegionAnnouncement(
    done ? m.reservations_access_copied({}, { locale }) : undefined,
    "polite"
  );
  useLiveRegionAnnouncement(
    AsyncResult.isFailure(copied)
      ? m.reservations_access_copy_failed({}, { locale })
      : undefined,
    "assertive"
  );
  return (
    <Pressable
      role="button"
      aria-label={label}
      disabled={copied.waiting && !done}
      onPress={() => copy(code)}
      style={({ pressed }) => [
        isWide ? styles.copyButton : styles.iconButton,
        pressed && styles.onNavyPressed,
      ]}
    >
      <Icon
        icon={done ? Check : Copy}
        size={done ? 24 : 20}
        color={done ? color.positive : color.white}
      />
      {isWide && (
        <Text variant="label" style={styles.copyLabel}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function StatusChip({ chip }: { readonly chip: AccessChip }) {
  const locale = useAppLocale();
  const { isWide } = useViewport();
  const tone = {
    Starts: styles.chipSoon,
    Active: styles.chipLive,
    Ended: styles.chipOver,
  }[chip._tag];
  const ink = {
    Starts: color.white,
    Active: color.onPositive,
    Ended: color.onNavyMuted,
  }[chip._tag];
  return (
    <View style={isWide ? styles.wideChipRow : styles.chipRow}>
      <View style={[styles.chip, tone]}>
        {chip._tag === "Starts" && <Icon icon={Clock} size={16} color={ink} />}
        {chip._tag === "Active" && <View aria-hidden style={styles.liveDot} />}
        <Text variant="label" numeric style={[styles.chipText, { color: ink }]}>
          {accessChipText(chip, locale)}
        </Text>
      </View>
    </View>
  );
}

/** The window's rows, the address, Get directions and Add to calendar. */
function WindowAndPlace({
  orderId,
  window,
  row,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly window: Option.Option<AccessWindow>;
  readonly row: Option.Option<ReservationListRow>;
}) {
  const locale = useAppLocale();
  const { isWide } = useViewport();
  const establishment = AsyncResult.value(useAtomValue(establishmentAtom));
  const [calendar, shareEvent] = useAtom(calendarShareAtom(orderId));
  const event = Option.getOrUndefined(
    Option.flatMap(row, (found) =>
      Option.map(
        Option.all([
          Option.flatMap(Option.fromNullishOr(found.startsAt), DateTime.make),
          Option.flatMap(Option.fromNullishOr(found.endsAt), DateTime.make),
        ]),
        ([start, end]) => ({
          orderId,
          title: reservationProductTitle(found.product, locale),
          start,
          end,
          location: Option.getOrUndefined(
            Option.map(establishment, (place) => place.formattedAddress)
          ),
        })
      )
    )
  );
  const rows: ReadonlyArray<readonly [string, ReactNode]> = [
    ...Option.match(window, {
      onNone: () => [],
      onSome: (parsed) =>
        AccessWindowSpan.$match(
          isWide
            ? AccessWindowSpan.Times({
                from: parsed.startsAt,
                until: parsed.endsAt,
              })
            : accessWindowSpanOf(parsed),
          {
            Days: ({ first, last }) => [
              [
                m.reservations_access_for({}, { locale }),
                accessDaysText(first, last, locale),
              ] as const,
            ],
            Times: ({ from, until }) => [
              [
                m.reservations_access_from({}, { locale }),
                accessDateTimeText(from, locale, "start"),
              ] as const,
              [
                m.reservations_access_until({}, { locale }),
                accessDateTimeText(until, locale, "end"),
              ] as const,
            ],
          }
        ),
    }),
    ...Option.match(establishment, {
      onNone: () => [],
      onSome: (place) => [
        [
          m.reservations_access_where({}, { locale }),
          <AddressValue key="where" place={place} />,
        ] as const,
      ],
    }),
  ];
  return (
    <>
      {rows.length > 0 && (
        <Card padding="none">
          <View style={styles.rows}>
            {rows.map(([label, value], index) => (
              <Fragment key={label}>
                {index > 0 && <View style={styles.divider} />}
                <View style={[styles.row, isWide && styles.wideRow]}>
                  <Text
                    variant="rowValue"
                    tone="muted"
                    style={[styles.rowLabel, isWide && styles.wideRowLabel]}
                  >
                    {label}
                  </Text>
                  {typeof value === "string" ? (
                    <Text
                      variant="rowValue"
                      numeric
                      style={[styles.rowValue, isWide && styles.wideRowValue]}
                    >
                      {value}
                    </Text>
                  ) : (
                    value
                  )}
                </View>
              </Fragment>
            ))}
          </View>
        </Card>
      )}
      <View style={!isWide && rows.length > 0 && styles.actionsAfterCard}>
        <ListGroup>
          {Option.isSome(establishment) && (
            <ListRow
              kind="action"
              icon={MapPin}
              label={m.reservations_access_directions({}, { locale })}
              trailing="external"
              onPress={() => openDirections(establishment.value)}
            />
          )}
          {event !== undefined && (
            <ListRow
              kind="action"
              icon={CalendarPlus}
              label={m.reservations_add_to_calendar({}, { locale })}
              trailing="none"
              disabled={calendar.waiting}
              onPress={() => shareEvent(event)}
            />
          )}
        </ListGroup>
      </View>
      <Notice
        tone="error"
        message={
          AsyncResult.isFailure(calendar)
            ? m.reservations_calendar_share_failed({}, { locale })
            : undefined
        }
      />
    </>
  );
}

/** The address in postal format; a tap copies it, confirmed in place. */
function AddressValue({ place }: { readonly place: CustomerEstablishment }) {
  const locale = useAppLocale();
  const { isWide } = useViewport();
  const [copied, copy] = useAtom(copyAddressAtom);
  const done = showsCopied(copied);
  const [street, city] = establishmentAddressLines(place);
  useLiveRegionAnnouncement(
    done ? m.reservations_access_address_copied({}, { locale }) : undefined,
    "polite"
  );
  return (
    <Pressable
      role="button"
      aria-label={`${m.reservations_access_copy_address({}, { locale })}: ${place.formattedAddress}`}
      onPress={() => copy(establishmentCopyText(place))}
      style={({ pressed }) => [
        styles.address,
        isWide && styles.wideAddress,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.addressLines, isWide && styles.wideAddressLines]}>
        <Text variant="rowValue" style={!isWide && styles.rowValue}>
          {street}
        </Text>
        <Text variant="rowValue" style={!isWide && styles.rowValue}>
          {city}
        </Text>
      </View>
      <View style={[styles.addressIcon, isWide && styles.wideAddressIcon]}>
        <Icon
          icon={done ? Check : Copy}
          size={16}
          color={done ? color.positiveInk : color.ink2}
        />
      </View>
    </Pressable>
  );
}

/** The window's card in the loading state: skeleton lines in its place. */
function LoadingWindow() {
  return (
    <Card>
      <View style={styles.skeleton}>
        <Skeleton width="50%" height={14} />
        <Skeleton width="80%" height={14} />
        <Skeleton width="60%" height={14} />
      </View>
    </Card>
  );
}

/** No PIN for the order: why, Contact us, and the way back to the booking. */
function NoPin({ orderId }: { readonly orderId: CustomerReservationOrderId }) {
  const locale = useAppLocale();
  const router = useRouter();
  return (
    <Card padding="none">
      <EmptyState
        icon={Lock}
        title={m.reservations_access_no_pin_title({}, { locale })}
        body={m.reservations_access_no_pin_body({}, { locale })}
        live="polite"
      >
        <View style={styles.actions}>
          <Button
            icon={Mail}
            label={m.reservations_contact({}, { locale })}
            onPress={openContactPage}
          />
          <Button
            variant="quiet"
            label={m.reservations_access_back_to_booking({}, { locale })}
            onPress={() =>
              router.dismissTo({
                pathname: "/reservations/[orderId]",
                params: { orderId },
              })
            }
          />
        </View>
      </EmptyState>
    </Card>
  );
}

const styles = StyleSheet.create({
  accessLayout: { gap: space.lg },
  expandedLayout: { flexDirection: "row", gap: space.xxl },
  expandedPane: { flex: 1, minWidth: 0 },
  // Extend the narrow PIN band to the screen edges under the navy header.
  compactHeroPane: { marginHorizontal: -space.gutter, marginTop: -space.sm },
  detailsPane: { gap: space.md },
  hero: {
    backgroundColor: color.navy,
    paddingBottom: 28,
    paddingHorizontal: space.gutter,
  },
  wideHero: {
    ...shadow.card,
    borderRadius: radius.card,
    flexGrow: 1,
    padding: space.xxl,
  },
  heroHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    justifyContent: "space-between",
  },
  name: {
    color: color.onNavyMuted,
    paddingHorizontal: touchTarget,
    paddingTop: space.xl,
    textAlign: "center",
  },
  wideName: {
    color: color.white,
    flexShrink: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    textAlign: "left",
  },
  heroFooter: {
    alignItems: "center",
    borderColor: "rgba(255, 255, 255, 0.18)",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
    justifyContent: "space-between",
    paddingTop: space.lg,
  },
  heroAction: { position: "absolute", right: space.sm, top: space.xs },
  iconButton: {
    alignItems: "center",
    borderRadius: touchTarget / 2,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  copyButton: {
    alignItems: "center",
    borderColor: color.onNavyMuted,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: space.sm,
    maxWidth: "100%",
    minHeight: touchTarget,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  copyLabel: { color: color.white, flexShrink: 1 },
  onNavyPressed: { backgroundColor: "rgba(255, 255, 255, 0.12)" },
  pressed: { opacity: 0.7 },
  pin: {
    alignSelf: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    paddingTop: 14,
    rowGap: space.md,
  },
  widePin: {
    alignContent: "center",
    flexGrow: 1,
    paddingBottom: space.xxxl,
    paddingTop: space.xxxl,
  },
  group: { flexDirection: "row" },
  box: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderColor: "rgba(255, 255, 255, 0.18)",
    borderWidth: 1,
    justifyContent: "center",
  },
  boxEmpty: { backgroundColor: "rgba(255, 255, 255, 0.08)" },
  digit: { color: color.white, fontWeight: "700", textAlign: "center" },
  digitEnded: { color: "rgba(255, 255, 255, 0.38)" },
  strike: {
    backgroundColor: "rgba(255, 255, 255, 0.38)",
    height: 2,
    left: "22%",
    position: "absolute",
    right: "22%",
    top: "46%",
  },
  how: {
    alignItems: "center",
    columnGap: space.sm,
    flexDirection: "row",
    justifyContent: "center",
    marginTop: space.md,
  },
  howText: { color: color.onNavyMuted, flexShrink: 1, textAlign: "center" },
  wideHow: {
    flexBasis: 156,
    flexGrow: 1,
    flexShrink: 1,
    justifyContent: "flex-start",
    marginTop: 0,
    minWidth: 0,
  },
  wideHowText: { textAlign: "left" },
  chipRow: { alignItems: "center", marginTop: space.lg },
  wideChipRow: { flexShrink: 1, maxWidth: "100%" },
  chip: {
    alignItems: "center",
    borderRadius: radius.pill,
    columnGap: space.sm,
    flexDirection: "row",
    maxWidth: "100%",
    minHeight: 32,
    paddingHorizontal: 14,
    paddingVertical: space.xs + space.xxs,
  },
  chipSoon: { backgroundColor: "rgba(255, 255, 255, 0.12)" },
  chipLive: { backgroundColor: color.positive },
  chipOver: { backgroundColor: "rgba(255, 255, 255, 0.12)" },
  chipText: { flexShrink: 1, textAlign: "center" },
  liveDot: {
    backgroundColor: color.positiveInk,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  rows: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  row: {
    columnGap: space.lg,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingVertical: space.md,
  },
  divider: { backgroundColor: color.divider, height: 1 },
  rowLabel: { flexShrink: 0 },
  rowValue: { flexShrink: 1, marginLeft: "auto", textAlign: "right" },
  wideRow: { flexWrap: "nowrap", justifyContent: "flex-start" },
  wideRowLabel: { flexBasis: "16%", minWidth: 64 },
  wideRowValue: { flex: 1, marginLeft: 0, minWidth: 0, textAlign: "left" },
  address: {
    alignItems: "flex-start",
    columnGap: space.sm,
    flexDirection: "row",
    flexShrink: 1,
    marginLeft: "auto",
  },
  addressLines: { alignItems: "flex-end", flexShrink: 1 },
  addressIcon: { paddingTop: space.xs },
  wideAddress: { flex: 1, marginLeft: 0, minHeight: touchTarget, minWidth: 0 },
  wideAddressLines: { alignItems: "flex-start", flex: 1, minWidth: 0 },
  wideAddressIcon: { paddingTop: 0 },
  skeleton: { gap: space.md },
  actions: { alignSelf: "stretch", gap: space.sm, marginTop: space.lg },
  // Board 24 has 16 between the window card and the actions; the screen's
  // column adds 12 between its children.
  actionsAfterCard: { marginTop: space.lg - space.md },
});
