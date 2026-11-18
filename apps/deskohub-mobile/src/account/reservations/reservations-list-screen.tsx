import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import {
  useAtom,
  useAtomMount,
  useAtomRefresh,
  useAtomValue,
} from "@effect/atom-react";
import { DateTime, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useIsFocused, useRouter } from "expo-router";
import CalendarIcon from "lucide-react-native/icons/calendar";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Copy from "lucide-react-native/icons/copy";
import Hourglass from "lucide-react-native/icons/hourglass";
import KeyRound from "lucide-react-native/icons/key-round";
import { AccessPinButton } from "./access-pin-button";
import { WithdrawalLink } from "./withdrawal-link";
import { type ReactNode, useEffect, useState } from "react";
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import type { CustomerRequestFailure } from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant } from "../../i18n/date-time-format";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Badge } from "../../ui/badge";
import { Card } from "../../ui/card";
import { Button } from "../../ui/controls";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import { ListGroup, SectionHeader } from "../../ui/list";
import { Masthead } from "../../ui/masthead";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Skeleton, SkeletonGroup } from "../../ui/skeleton";
import { Text } from "../../ui/text";
import { useToast } from "../../ui/toast";
import { brandText, color, radius, space } from "../../ui/tokens";
import {
  type AccountNotice,
  type ReservationsAccess,
  reservationsAccess,
  tabGate,
} from "../account-gating";
import { TabGateCard } from "../tab-gate-card";
import { accessPinGroups } from "./access-pin-groups";
import { useAccessPinView } from "./access-pin-view";
import { copyAccessCodeAtom } from "./access-screen-state";
import { bookingEntryEnabled } from "./booking-entry";
import {
  BookingTicket,
  BookingTicketSkeleton,
  DateTile,
  DateTilePlaceholder,
} from "./booking-ticket";
import { countdownText, ticketBadge } from "./booking-ticket-text";
import { establishmentAtom, establishmentPlace } from "./establishment";
import {
  type NextAccess,
  nextReservationView,
  type ReservationGroups,
  type ReservationListRow,
  reservationRowView,
  reservationStatusTarget,
} from "./reservation-list-model";
import {
  type ReservationsList,
  reservationHistoryAtom,
  reservationsListAtom,
  savedReservationsAtom,
  savedReservationsBeforeAccountAtom,
} from "./reservations-list-state";

/** How many past bookings show before "Show all". */
export const pastPreviewCount = 2;

const gateNotice: Record<AccountNotice, (locale: AppLocale) => string> = {
  "completion-required": (locale) =>
    m.account_notice_completion_required({}, { locale }),
  "support-required": (locale) =>
    m.account_notice_support_required({}, { locale }),
  unavailable: (locale) => m.account_notice_unavailable({}, { locale }),
  "deletion-pending": (locale) =>
    m.account_notice_deletion_pending({}, { locale }),
};

const gateNoticeOf = (access: ReservationsAccess): AccountNotice | undefined =>
  ({
    available: undefined,
    "completion-required": "completion-required" as const,
    unavailable: access.kind === "unavailable" ? access.notice : undefined,
  })[access.kind];

/** Opens a reservation's booking view. */
const useOpenReservation = () => {
  const router = useRouter();
  return (orderId: CustomerReservationOrderId) =>
    router.push({ pathname: "/reservations/[orderId]", params: { orderId } });
};

/** The tab root's masthead. */
function ReservationsMasthead() {
  const locale = useAppLocale();
  return <Masthead title={m.account_section_reservations({}, { locale })} />;
}

/** The tab's screen: the masthead over its content, pull to refresh. */
function ReservationsScreen({
  refreshing,
  onRefresh,
  children,
}: {
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  readonly children: ReactNode;
}) {
  return (
    <ScrollScreen
      masthead={<ReservationsMasthead />}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {children}
    </ScrollScreen>
  );
}

/**
 * The Reservations tab: the next booking as its ticket, then the later and
 * past ones (GET /reservations), gated by the account's state. Saved
 * reservations show at once while the list loads, and stay when it can't;
 * they also show while the account itself can't be read (offline at launch).
 */
export function ReservationsListScreen() {
  // Read once for the screen, whichever of the views below shows it.
  useAtomMount(savedReservationsAtom);
  const account = useAtomValue(accountAtom);
  return (
    <>
      {Option.match(
        Option.map(AsyncResult.value(account), reservationsAccess),
        {
          onNone: () => <ReservationsBeforeAccount />,
          onSome: (access) =>
            access.kind === "available" ? (
              <ReservationsHistory />
            ) : (
              <ReservationsGate access={access} />
            ),
        }
      )}
    </>
  );
}

/** When the account may not see reservations. */
function ReservationsGate({ access }: { readonly access: ReservationsAccess }) {
  const locale = useAppLocale();
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  // A gate card says it all; other states keep their notice.
  const gate = tabGate("reservations", access);
  const shownNotice = gate === undefined ? gateNoticeOf(access) : undefined;
  const notice =
    shownNotice === undefined ? undefined : gateNotice[shownNotice](locale);
  return (
    <ReservationsScreen refreshing={account.waiting} onRefresh={refresh}>
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice tone="info" message={notice} />
      <AsyncView
        result={account}
        onRetry={refresh}
        errorTitle={m.reservations_load_failed_title({}, { locale })}
      >
        {() => gate !== undefined && <TabGateCard gate={gate} />}
      </AsyncView>
    </ReservationsScreen>
  );
}

/** Before the account is read: the saved reservations, if any. */
function ReservationsBeforeAccount() {
  return (
    <ReservationsListView
      result={useAtomValue(savedReservationsBeforeAccountAtom)}
      onRefresh={useAtomRefresh(accountAtom)}
    />
  );
}

/** The account may see reservations: the list, saved then fresh. */
function ReservationsHistory() {
  return (
    <ReservationsListView
      result={useAtomValue(reservationsListAtom)}
      onRefresh={useAtomRefresh(reservationHistoryAtom)}
    />
  );
}

function ReservationsListSkeleton() {
  const locale = useAppLocale();
  return (
    <View style={styles.stack}>
      <BookingTicketSkeleton
        label={m.account_loading({}, { locale })}
        stub="row"
      />
      <SkeletonGroup label={m.account_loading({}, { locale })}>
        <View style={styles.sectionSkeleton}>
          <Skeleton width={64} height={12} radius={6} />
        </View>
        <ListGroup>
          {[0, 1].map((row) => (
            <View key={row} style={styles.row}>
              <Skeleton width={52} height={58} radius={14} />
              <View style={[styles.rowText, styles.skeletonText]}>
                <Skeleton width="56%" height={14} radius={7} />
                <Skeleton width="42%" height={10} radius={5} />
              </View>
            </View>
          ))}
        </ListGroup>
      </SkeletonGroup>
    </View>
  );
}

function ReservationsListView<E extends CustomerRequestFailure>({
  result: list,
  onRefresh: refresh,
}: {
  readonly result: AsyncResult.AsyncResult<ReservationsList, E>;
  readonly onRefresh: () => void;
}) {
  const locale = useAppLocale();
  const savedAt = Option.flatMap(
    AsyncResult.value(list),
    (shown) => shown.savedAt
  );
  // The saved list says it is the one on this device; a failed refresh
  // under it needs no second notice.
  const shown = Option.match(AsyncResult.value(list), {
    onSome: (value) =>
      Option.isSome(value.savedAt) && AsyncResult.isFailure(list)
        ? AsyncResult.success<ReservationsList, E>(value, {
            waiting: list.waiting,
          })
        : list,
    onNone: () => list,
  });
  return (
    <ReservationsScreen
      refreshing={list.waiting && !AsyncResult.isInitial(list)}
      onRefresh={refresh}
    >
      <AsyncView
        result={shown}
        onRetry={refresh}
        errorTitle={m.reservations_load_failed_title({}, { locale })}
        loading={<ReservationsListSkeleton />}
      >
        {({ groups }) => (
          <ReservationGroupsView
            groups={groups}
            // The list from the device, with when it was saved.
            savedNotice={
              <Notice
                tone="info"
                message={Option.getOrUndefined(
                  Option.map(savedAt, (time) =>
                    m.reservations_last_updated(
                      { time: formatInstant(time, locale, "date-time") },
                      { locale }
                    )
                  )
                )}
              />
            }
          />
        )}
      </AsyncView>
    </ReservationsScreen>
  );
}

function BookButton() {
  const locale = useAppLocale();
  const router = useRouter();
  return bookingEntryEnabled ? (
    <Button
      icon={CalendarPlus}
      label={m.reservations_book({}, { locale })}
      onPress={() => router.push("/book")}
    />
  ) : null;
}

function ReservationGroupsView({
  groups,
  savedNotice,
}: {
  readonly groups: ReservationGroups;
  readonly savedNotice: ReactNode;
}) {
  const locale = useAppLocale();
  if (groups.empty) {
    return (
      <View style={styles.stack}>
        <Card>
          <EmptyState
            icon={CalendarIcon}
            title={m.reservations_none_yet({}, { locale })}
          >
            <BookButton />
          </EmptyState>
        </Card>
        {savedNotice}
      </View>
    );
  }
  const later = [...groups.moreCurrent, ...groups.undated];
  return (
    <View style={styles.stack}>
      {Option.match(groups.featured, {
        onSome: (row) => <NextReservation row={row} />,
        onNone: () => <NothingUpcoming />,
      })}
      {savedNotice}
      {later.length > 0 && (
        <View>
          <SectionHeader title={m.reservations_section_later({}, { locale })} />
          <ReservationRows rows={later} place="later" />
        </View>
      )}
      {groups.past.length > 0 && <PastReservations rows={groups.past} />}
    </View>
  );
}

/** No booking ahead: Book is the one action. */
function NothingUpcoming() {
  const locale = useAppLocale();
  return (
    <Card>
      <View style={styles.nothing}>
        <View style={styles.nothingHead}>
          <View style={styles.nothingDisc}>
            <Icon icon={CalendarPlus} color={color.action} />
          </View>
          <Text variant="headline" style={styles.rowText}>
            {m.reservations_nothing_upcoming({}, { locale })}
          </Text>
        </View>
        <BookButton />
      </View>
    </Card>
  );
}

function PastReservations({
  rows,
}: {
  readonly rows: ReadonlyArray<ReservationListRow>;
}) {
  const locale = useAppLocale();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, pastPreviewCount);
  return (
    <View>
      <SectionHeader title={m.reservations_section_past({}, { locale })} />
      <ReservationRows
        rows={shown}
        place="past"
        footer={
          rows.length > shown.length ? (
            <Button
              variant="text"
              label={m.reservations_show_all_past({}, { locale })}
              onPress={() => setAll(true)}
            />
          ) : undefined
        }
      />
    </View>
  );
}

function ReservationRows({
  rows,
  place,
  footer,
}: {
  readonly rows: ReadonlyArray<ReservationListRow>;
  readonly place: "later" | "past";
  readonly footer?: ReactNode;
}) {
  return (
    <View style={styles.group}>
      {rows.map((row, index) => (
        <ReservationRow
          key={row.id}
          row={row}
          place={place}
          divided={index > 0}
        />
      ))}
      {footer}
    </View>
  );
}

/** A later or past booking: its day's tile, name and time. */
function ReservationRow({
  row,
  place,
  divided,
}: {
  readonly row: ReservationListRow;
  readonly place: "later" | "past";
  readonly divided: boolean;
}) {
  const locale = useAppLocale();
  const open = useOpenReservation();
  const view = reservationRowView(row, place, locale);
  const target = reservationStatusTarget(row);
  const past = place === "past";
  const badge = Option.map(view.badge, (kind) => ticketBadge(kind, locale));
  // The row's width: its badge wraps past about a third of it.
  const [rowWidth, setRowWidth] = useState(0);
  const measureRow = (event: LayoutChangeEvent) =>
    setRowWidth(event.nativeEvent.layout.width);
  const content = (
    <>
      {divided && <View aria-hidden style={styles.divider} />}
      {Option.match(view.date, {
        onSome: (parts) => (
          <DateTile parts={parts} tone={past ? "dim" : "soft"} compact />
        ),
        onNone: () => <DateTilePlaceholder />,
      })}
      <View style={styles.rowText}>
        <Text
          variant="bodyStrong"
          style={past ? styles.pastTitle : undefined}
        >
          {view.title}
        </Text>
        <Text variant="bodySmall" style={styles.rowDetail}>
          {view.detail}
        </Text>
        {!past &&
          row.withdrawal?.eligible === true &&
          Option.isSome(target) && (
            <WithdrawalLink
              orderId={target.value}
              style={styles.rowWithdrawal}
              underlined
            />
          )}
      </View>
      {Option.match(badge, {
        // The badge heads the right column; the chevron centres in what's
        // left below it.
        onSome: (badge) => (
          <View style={styles.rowAside}>
            <Badge
              label={badge.label}
              tone={badge.tone}
              icon={badge.icon}
              wrapAt={rowWidth / 3}
            />
            {Option.isSome(target) && (
              <View style={styles.rowAsideChevron}>
                <Icon icon={ChevronRight} size={20} color={color.ink3} />
              </View>
            )}
          </View>
        ),
        onNone: () =>
          Option.isSome(target) && (
            <Icon icon={ChevronRight} size={20} color={color.ink3} />
          ),
      })}
    </>
  );
  return Option.match(target, {
    onNone: () => (
      <View accessible onLayout={measureRow} style={styles.row}>
        {content}
      </View>
    ),
    onSome: (orderId) => (
      <Pressable
        role="link"
        onLayout={measureRow}
        onPress={() => open(orderId)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    ),
  });
}

/** The next booking as its ticket, with its PIN one tap away. */
function NextReservation({ row }: { readonly row: ReservationListRow }) {
  const locale = useAppLocale();
  const open = useOpenReservation();
  const establishment = AsyncResult.value(useAtomValue(establishmentAtom));
  const view = nextReservationView(row, DateTime.nowUnsafe(), locale);
  const target = reservationStatusTarget(row);
  return (
    <BookingTicket
      onPress={Option.getOrUndefined(
        Option.map(target, (orderId) => () => open(orderId))
      )}
      lead={Option.getOrUndefined(
        Option.map(view.countdown, (countdown) => ({
          kind: "countdown" as const,
          text: countdownText(countdown, locale),
        }))
      )}
      badge={ticketBadge(view.badge, locale)}
      date={Option.getOrUndefined(view.date)}
      title={view.title}
      lines={[
        view.when,
        ...Option.toArray(Option.map(establishment, establishmentPlace)),
      ]}
      stub="row"
    >
      <NextAccessLine
        access={view.access}
        orderId={Option.getOrUndefined(target)}
        withdrawable={row.withdrawal?.eligible === true}
      />
    </BookingTicket>
  );
}

function AccessTile({ waiting = false }: { readonly waiting?: boolean }) {
  return (
    <View
      aria-hidden
      style={[styles.accessTile, waiting && styles.accessTileWaiting]}
    >
      <Icon
        icon={waiting ? Hourglass : KeyRound}
        size={20}
        color={waiting ? color.navy : color.positiveInk}
      />
    </View>
  );
}

/**
 * The least width the stub's text keeps: what fits beside the action at the
 * default font size, growing with the system font so the action wraps under
 * the text rather than squeezing it.
 */
const useStubTextWidth = () => {
  const { fontScale } = useWindowDimensions();
  return { minWidth: 140 * fontScale };
};

/** The stub of the next booking's ticket: today's PIN, or the way to it. */
function NextAccessLine({
  access,
  orderId,
  withdrawable,
}: {
  readonly access: NextAccess;
  readonly orderId: CustomerReservationOrderId | undefined;
  readonly withdrawable: boolean;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const open = useOpenReservation();
  const stubTextWidth = useStubTextWidth();
  switch (access._tag) {
    case "Pin":
      return orderId === undefined ? null : (
        <TodayPin code={access.code} until={access.until} orderId={orderId} />
      );
    case "Ready":
      return (
        <>
          {orderId !== undefined && (
            <View style={styles.stubActions}>
              {withdrawable && (
                <WithdrawalLink
                  orderId={orderId}
                  style={styles.stubWithdrawal}
                  underlined
                />
              )}
              <AccessPinButton orderId={orderId} />
            </View>
          )}
        </>
      );
    case "AfterPayment":
      return (
        <>
          <AccessTile waiting />
          <Text variant="subhead" style={[styles.stubText, stubTextWidth]}>
            {m.reservations_pin_after_payment({}, { locale })}
          </Text>
          {orderId !== undefined && (
            <Button
              variant="secondary"
              size="small"
              width="content"
              label={m.reservations_check({}, { locale })}
              onPress={() => open(orderId)}
            />
          )}
        </>
      );
  }
}

/** Today's PIN on the ticket, with Copy. */
function TodayPin({
  code,
  until,
  orderId,
}: {
  readonly code: string;
  readonly until: string;
  readonly orderId: CustomerReservationOrderId;
}) {
  const locale = useAppLocale();
  const toast = useToast();
  const stubTextWidth = useStubTextWidth();
  const [copied, copy] = useAtom(copyAccessCodeAtom(orderId));
  useAccessPinView(useIsFocused());
  // Says how the copy went, once per copy.
  useEffect(() => {
    if (copied.waiting || AsyncResult.isInitial(copied)) return;
    toast.show(
      AsyncResult.isSuccess(copied)
        ? { message: m.reservations_access_copied({}, { locale }) }
        : {
            message: m.reservations_access_copy_failed({}, { locale }),
            tone: "neutral",
          }
    );
  }, [copied, toast, locale]);
  return (
    <>
      <AccessTile />
      <View style={[styles.stubText, stubTextWidth]}>
        <Text variant="hint">
          {m.reservations_pin_today_until({ time: until }, { locale })}
        </Text>
        <Text
          numeric
          aria-label={m.reservations_access_code_label(
            { digits: code.split("").join(" ") },
            { locale }
          )}
          style={styles.pin}
        >
          {accessPinGroups(code).join(" ")}
        </Text>
      </View>
      <Pressable
        role="button"
        aria-label={m.reservations_access_copy({}, { locale })}
        disabled={copied.waiting}
        hitSlop={space.xs}
        onPress={() => copy(code)}
        style={({ pressed }) => [styles.copy, pressed && styles.pressed]}
      >
        <Icon icon={Copy} size={20} />
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  rowDetail: { marginTop: 2 },
  // A row's status badge over its chevron, at most about a third of the row.
  rowAside: { alignItems: "flex-end", alignSelf: "stretch", flexShrink: 0 },
  rowAsideChevron: { flex: 1, justifyContent: "center", paddingTop: space.xs },
  rowWithdrawal: { alignSelf: "flex-start", marginTop: 2 },
  stubActions: { gap: space.sm, width: "100%" },
  stubWithdrawal: { alignSelf: "center", textAlign: "center" },
  pressed: { opacity: 0.7 },
  group: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: space.md,
  },
  divider: {
    backgroundColor: color.divider,
    height: 1,
    left: 82,
    position: "absolute",
    right: 0,
    top: 0,
  },
  rowText: { flex: 1, minWidth: 0 },
  // The stub's text keeps room to read; at large font sizes the action
  // wraps under it (see `useStubTextWidth`).
  stubText: { flexBasis: 0, flexGrow: 1 },
  skeletonText: { gap: space.sm },
  sectionSkeleton: { paddingBottom: space.sm, paddingTop: space.xl },
  pastTitle: { color: color.ink2 },
  nothing: { gap: space.md },
  nothingHead: { alignItems: "center", flexDirection: "row", gap: 14 },
  nothingDisc: {
    alignItems: "center",
    backgroundColor: color.actionTint,
    borderRadius: 14,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  accessTile: {
    alignItems: "center",
    backgroundColor: color.positiveTint,
    borderRadius: radius.tile,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  accessTileWaiting: { backgroundColor: color.sunken },
  pin: { ...brandText(24, 30, 700, 2), color: color.navy },
  copy: {
    alignItems: "center",
    backgroundColor: color.sunken,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
});
