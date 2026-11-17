import type {
  CustomerEstablishment,
  CustomerReservationAccess,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { DateTime, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
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
import { Fragment, type ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
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
import { color, radius, space, touchTarget } from "../../ui/tokens";
import {
  accessPinBox,
  accessPinBoxSize,
  accessPinGroups,
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
} as const;

/**
 * An order's door PIN (board 24): the PIN large on navy in groups, its
 * Copy action top right, how to use it, and a status chip from the lock's
 * window; under it the window, the address that copies on tap, Get
 * directions and Add to calendar. An ended PIN is struck through, with Book
 * again. An order without a PIN explains why and offers Contact us. Pull
 * to read it again.
 */
export function ReservationAccessScreen({
  orderId,
}: {
  readonly orderId: CustomerReservationOrderId;
}) {
  const locale = useAppLocale();
  const read = shownAccess(useAtomValue(reservationAccessAtom(orderId)));
  const refresh = useAtomRefresh(reservationAccessAtom(orderId));
  const row = useAtomValue(reservationOfOrderAtom(orderId));
  const state = accessScreenStateOf(read);
  const refreshing = !AsyncResult.isInitial(read) && read.waiting;
  // Always mounted, so the header follows the state both ways: a No PIN
  // that a refresh turns into a PIN gets the navy header back.
  const header = (
    <Stack.Screen
      options={{ header: accessStackHeader[accessHeaderTone(state)] }}
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
          <ScrollScreen
            overlap={false}
            masthead={
              <PinHero name={name}>
                <PinDigits groups={placeholderGroups} placeholder />
              </PinHero>
            }
          >
            <LoadingWindow />
          </ScrollScreen>
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
    <ScrollScreen
      overlap={false}
      refreshing={refreshing}
      onRefresh={onRefresh}
      masthead={
        <PinHero
          name={name}
          action={
            ended ? undefined : <CopyPin orderId={orderId} code={access.code} />
          }
        >
          <PinDigits groups={accessPinGroups(access.code)} ended={ended} />
          {!ended && (
            <View style={styles.how}>
              <Icon icon={DoorOpen} size={16} color={color.onNavyMuted} />
              <Text variant="hint" style={styles.howText}>
                {m.reservations_access_how({}, { locale })}
              </Text>
            </View>
          )}
          {chip !== undefined && <StatusChip chip={chip} />}
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
    </ScrollScreen>
  );
}

/**
 * The navy band under the app bar: the space's name (a line held while it
 * is unknown), an action at its top end, and the PIN with what follows it.
 */
function PinHero({
  name,
  action,
  children,
}: {
  readonly name: string | undefined;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <View style={styles.hero}>
      <Text variant="lead" style={styles.name}>
        {name ?? " "}
      </Text>
      {action !== undefined && <View style={styles.heroAction}>{action}</View>}
      {children}
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
  const { width, fontScale } = useWindowDimensions();
  const size = accessPinBoxSize(groups, width - 2 * space.gutter, fontScale);
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
      style={styles.pin}
    >
      {groups.map((group, groupIndex) => (
        <View
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          // biome-ignore lint/suspicious/noArrayIndexKey: PIN groups are positional.
          key={groupIndex}
          style={styles.group}
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

/**
 * Copy PIN, top right: copies the PIN and nothing else, and turns into a
 * check for two seconds instead of a toast.
 */
function CopyPin({
  orderId,
  code,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly code: string;
}) {
  const locale = useAppLocale();
  const [copied, copy] = useAtom(copyPinWithFeedbackAtom(orderId));
  const done = showsCopied(copied);
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
      aria-label={
        done
          ? m.reservations_access_copied({}, { locale })
          : m.reservations_access_copy({}, { locale })
      }
      disabled={copied.waiting && !done}
      onPress={() => copy(code)}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && styles.onNavyPressed,
      ]}
    >
      <Icon
        icon={done ? Check : Copy}
        size={done ? 24 : 20}
        color={done ? color.positive : color.white}
      />
    </Pressable>
  );
}

/** The status chip under the PIN: when it starts, that it works now, or that it ended. */
function StatusChip({ chip }: { readonly chip: AccessChip }) {
  const locale = useAppLocale();
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
    <View style={styles.chipRow}>
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
        AccessWindowSpan.$match(accessWindowSpanOf(parsed), {
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
        }),
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
                <View style={styles.row}>
                  <Text variant="rowValue" tone="muted" style={styles.rowLabel}>
                    {label}
                  </Text>
                  {typeof value === "string" ? (
                    <Text variant="rowValue" numeric style={styles.rowValue}>
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
      <View style={rows.length > 0 && styles.actionsAfterCard}>
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
      style={({ pressed }) => [styles.address, pressed && styles.pressed]}
    >
      <View style={styles.addressLines}>
        <Text variant="rowValue" style={styles.rowValue}>
          {street}
        </Text>
        <Text variant="rowValue" style={styles.rowValue}>
          {city}
        </Text>
      </View>
      <View style={styles.addressIcon}>
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
  hero: {
    backgroundColor: color.navy,
    paddingBottom: 28,
    paddingHorizontal: space.gutter,
  },
  name: {
    color: color.onNavyMuted,
    paddingHorizontal: touchTarget,
    paddingTop: space.xl,
    textAlign: "center",
  },
  heroAction: { position: "absolute", right: space.sm, top: space.xs },
  iconButton: {
    alignItems: "center",
    borderRadius: touchTarget / 2,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  onNavyPressed: { backgroundColor: "rgba(255, 255, 255, 0.12)" },
  pressed: { opacity: 0.7 },
  pin: {
    columnGap: accessPinBox.groupGap,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    paddingTop: 14,
    rowGap: space.md,
  },
  group: { columnGap: accessPinBox.digitGap, flexDirection: "row" },
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
  chipRow: { alignItems: "center", marginTop: space.lg },
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
  address: {
    alignItems: "flex-start",
    columnGap: space.sm,
    flexDirection: "row",
    flexShrink: 1,
    marginLeft: "auto",
  },
  addressLines: { alignItems: "flex-end", flexShrink: 1 },
  addressIcon: { paddingTop: space.xs },
  skeleton: { gap: space.md },
  actions: { alignSelf: "stretch", gap: space.sm, marginTop: space.lg },
  // Board 24 has 16 between the window card and the actions; the screen's
  // column adds 12 between its children.
  actionsAfterCard: { marginTop: space.lg - space.md },
});
