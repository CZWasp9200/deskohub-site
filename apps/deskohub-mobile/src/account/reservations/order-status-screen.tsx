import type {
  CustomerBookedSelection,
  CustomerOrderState,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { DateTime, Match, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useFocusEffect, useRouter } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Download from "lucide-react-native/icons/download";
import FileText from "lucide-react-native/icons/file-text";
import Mail from "lucide-react-native/icons/mail";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Search from "lucide-react-native/icons/search";
import { type ReactNode, useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { apiOrigin } from "../../auth/auth-client";
import { bookAgainHref, reservationsHref } from "../../booking/booking-routes";
import { AsyncView, viewErrorOf } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import {
  type CustomerRequestFailure,
  CustomerViewError,
} from "../../customer-api/customer-view-error";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import {
  DownloadShareFailure,
  downloadShareFailureOf,
} from "../../customer-api/share-downloaded-file";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import { contactPageUrl } from "../../routing/site-page";
import { Card } from "../../ui/card";
import { Button, LiveMessage } from "../../ui/controls";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import { ListGroup, ListRow } from "../../ui/list";
import { useLiveRegionAnnouncement } from "../../ui/live-announcement";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";
import {
  BookingSteps,
  BookingTicket,
  BookingTicketSkeleton,
} from "./booking-ticket";
import {
  type BookingTicketModel,
  bookingTicketOf,
  withdrawnTicket,
  orderCheckingOf,
} from "./booking-ticket-model";
import { ticketBadge, ticketSteps } from "./booking-ticket-text";
import { type BookingEvent, calendarShareAtom } from "./calendar-event";
import { establishmentAtom } from "./establishment";
import { invoiceShareAtom } from "./invoice-share";
import { offersAccessLink, offersInvoice } from "./order-status-kind";
import { focusGained, focusLost, orderStatusAtoms } from "./order-status-state";
import { orderTicketView, reservationOfOrderAtom } from "./order-ticket-view";
import { bookedSelectionOf } from "./payment-recovery";
import { canRefreshManually, type StatusRefreshState } from "./status-refresh";
import { AutomaticRefresh, type StatusVisit } from "./status-refresh-rules";
import { usePaymentRecovery } from "./use-payment-recovery";
import Undo2 from "lucide-react-native/icons/undo-2";
import { AccessPinButton } from "./access-pin-button";
import { WhenWithdrawable } from "./withdrawal-offer";

/** Opens the site's contact form. */
export const openContactPage = () => {
  void openBrowserAsync(contactPageUrl(apiOrigin)).catch(() => undefined);
};

const invoiceFailureMessage = (
  failure: DownloadShareFailure,
  locale: AppLocale
) =>
  DownloadShareFailure.$match(failure, {
    Share: () => m.reservations_invoice_share_failed({}, { locale }),
    Download: ({ error }) =>
      Match.value(error).pipe(
        Match.tag("InvoiceNotIssued", () =>
          m.reservations_invoice_not_issued({}, { locale })
        ),
        Match.tag("NotFound", () =>
          m.reservations_invoice_not_found({}, { locale })
        ),
        Match.orElse(
          (other) =>
            sharedViewErrorMessage(other, locale) ??
            m.account_error_unexpected({}, { locale })
        )
      ),
  });

/** Calendar, invoice and Contact us: the quiet rows under a confirmed ticket. */
function MoreActions({
  order,
  event,
  withdrawn = false,
}: {
  readonly order: CustomerOrderState;
  /** Withdrawn from already: no second withdrawal. */
  readonly withdrawn?: boolean;
  /** The booking as a calendar event; none while its times are unknown. */
  readonly event: BookingEvent | undefined;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const invoice = useAtomValue(invoiceShareAtom(order.orderId));
  const shareInvoice = useAtomSet(invoiceShareAtom(order.orderId));
  const calendar = useAtomValue(calendarShareAtom(order.orderId));
  const shareEvent = useAtomSet(calendarShareAtom(order.orderId));
  const failure = AsyncResult.isFailure(invoice)
    ? downloadShareFailureOf(invoice.cause)
    : undefined;
  return (
    <>
      <ListGroup>
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
        {offersInvoice(order) && (
          <ListRow
            kind="action"
            icon={FileText}
            label={m.reservations_invoice_row({}, { locale })}
            trailing={<Icon icon={Download} size={20} color={color.ink3} />}
            disabled={invoice.waiting}
            onPress={() => shareInvoice()}
          />
        )}
        <ListRow
          kind="action"
          icon={Mail}
          label={m.reservations_contact({}, { locale })}
          trailing={<Icon icon={ChevronRight} size={20} color={color.ink3} />}
          onPress={openContactPage}
        />
        {!withdrawn && (
        <WhenWithdrawable orderId={order.orderId}>
          <ListRow
            kind="action"
            destructive
            icon={Undo2}
            label={m.reservations_withdraw({}, { locale })}
            trailing={
              <Icon icon={ChevronRight} size={20} color={color.ink3} />
            }
            onPress={() =>
              router.push({
                pathname: "/reservations/[orderId]/withdraw",
                params: { orderId: order.orderId },
              })
            }
          />
        </WhenWithdrawable>
        )}
      </ListGroup>
      <LiveMessage
        role="status"
        message={
          invoice.waiting
            ? m.reservations_invoice_preparing({}, { locale })
            : undefined
        }
      />
      <LiveMessage
        role="alert"
        message={
          failure === undefined
            ? undefined
            : invoiceFailureMessage(failure, locale)
        }
      />
      <LiveMessage
        role="alert"
        message={
          AsyncResult.isFailure(calendar)
            ? m.reservations_calendar_share_failed({}, { locale })
            : undefined
        }
      />
    </>
  );
}

/** A quiet Contact us under a ticket whose booking needs help or ended. */
function ContactLink() {
  const locale = useAppLocale();
  return (
    <Button
      variant="quiet"
      icon={Mail}
      label={m.reservations_contact({}, { locale })}
      onPress={openContactPage}
    />
  );
}

/** What stands under the perforation for the ticket's state. */
function TicketStub({
  model,
  order,
  booked,
  accessHint,
  checking,
  onCheckAgain,
  paymentPageAction,
  retryPaymentAction,
}: {
  readonly model: BookingTicketModel;
  readonly order: CustomerOrderState;
  /** What the order books, for Book again. */
  readonly booked: CustomerBookedSelection | undefined;
  readonly accessHint: string | undefined;
  /** A read the customer asked for is under way. */
  readonly checking: boolean;
  readonly onCheckAgain: () => void;
  /** Opens the order's payment page again. */
  readonly paymentPageAction: ReactNode;
  /** Pays the order again, its details kept. */
  readonly retryPaymentAction: ReactNode;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const { stub } = model;
  switch (stub._tag) {
    case "AccessPin":
      return offersAccessLink(order) ? (
        <>
          <AccessPinButton orderId={order.orderId} />
          {accessHint !== undefined && (
            <Text variant="hint" style={styles.centred}>
              {accessHint}
            </Text>
          )}
        </>
      ) : null;
    case "BookAgain":
      return (
        <>
          {stub.refundNote && (
            <Text variant="bodySmall" tone="default">
              {m.reservations_refund_note({}, { locale })}
            </Text>
          )}
          <Button
            icon={RotateCcw}
            label={m.reservations_book_again({}, { locale })}
            onPress={() => router.push(bookAgainHref(booked))}
          />
        </>
      );
    case "RetryPayment":
      return retryPaymentAction;
    case "Withdrawn":
      return (
        <Text variant="bodySmall" tone="default">
          {m.withdrawal_ticket_note(
            { amount: formatMoney(stub.refundAmount, locale) },
            { locale }
          )}
        </Text>
      );
    case "Steps":
      return (
        <>
          <BookingSteps steps={ticketSteps(stub.steps, locale)} />
          {Option.match(stub.action, {
            onNone: () => null,
            onSome: (action) =>
              ({
                "check-again": (
                  <Button
                    icon={RotateCcw}
                    label={m.reservations_check_again({}, { locale })}
                    busy={checking}
                    onPress={onCheckAgain}
                  />
                ),
                contact: (
                  <Button
                    icon={Mail}
                    label={m.reservations_contact({}, { locale })}
                    onPress={openContactPage}
                  />
                ),
                "payment-page": paymentPageAction,
              })[action],
          })}
        </>
      );
  }
}

function OrderTicket({
  state,
  onCheckAgain,
  onPaymentPageLeft,
}: {
  readonly state: StatusRefreshState;
  readonly onCheckAgain: () => void;
  /** The customer came back from the payment page: follow the payment. */
  readonly onPaymentPageLeft: () => void;
}) {
  const locale = useAppLocale();
  const { order } = state;
  const reservation = useAtomValue(reservationOfOrderAtom(order.orderId));
  const booked = bookedSelectionOf(order, reservation);
  const recovery = usePaymentRecovery(order, booked, {
    onCheckAgain,
    onPaymentPageLeft,
  });
  const model =
    order.withdrawal === undefined
      ? bookingTicketOf(
          order.status,
          orderCheckingOf(state.automatic),
          recovery.offer
        )
      : withdrawnTicket(order.withdrawal.refundAmount);
  const establishment = AsyncResult.value(useAtomValue(establishmentAtom));
  const ticketView = orderTicketView({
    order,
    model,
    reservation,
    establishment,
    now: DateTime.nowUnsafe(),
    locale,
  });
  // A withdrawn booking won't happen: no countdown, no PIN hint.
  const view =
    order.withdrawal === undefined
      ? ticketView
      : { ...ticketView, lead: undefined, accessHint: undefined };
  const badge = ticketBadge(model.badge, locale);
  // The status changes while the screen is open: announce the new one.
  useLiveRegionAnnouncement(
    view.lead?.kind === "reason"
      ? `${badge.label}. ${view.lead.text}`
      : badge.label,
    "polite"
  );
  // A payment action's answer, else the last read's own failure; a 429
  // reads as "temporarily limited".
  const failureMessage =
    recovery.notice ??
    Option.getOrUndefined(
      Option.map(
        state.failure,
        (failure) =>
          sharedViewErrorMessage(failure, locale) ??
          m.account_error_unexpected({}, { locale })
      )
    );
  return (
    <View style={styles.stack}>
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice tone="warning" message={failureMessage} />
      <BookingTicket
        lead={view.lead}
        badge={badge}
        date={view.date}
        dateTone={model.dim ? "dim" : "strong"}
        badgePlacement={order.withdrawal === undefined ? "header" : "inline"}
        title={view.title}
        lines={view.lines}
        meta={view.meta}
      >
        <TicketStub
          model={model}
          order={order}
          booked={booked}
          accessHint={view.accessHint}
          checking={state.reading}
          onCheckAgain={onCheckAgain}
          paymentPageAction={
            <Button
              label={m.booking_checkout_payment_reopen({}, { locale })}
              busy={recovery.reopening}
              disabled={recovery.busy}
              onPress={recovery.reopen}
            />
          }
          retryPaymentAction={
            <Button
              icon={RotateCcw}
              label={m.booking_checkout_retry_pay({}, { locale })}
              busy={recovery.retrying}
              disabled={recovery.busy}
              onPress={recovery.retry}
            />
          }
        />
      </BookingTicket>
      {model.followUp === "more-actions" && (
        <MoreActions
          order={order}
          // A withdrawn booking won't happen: nothing to add to a calendar.
          event={order.withdrawal === undefined ? view.event : undefined}
          withdrawn={order.withdrawal !== undefined}
        />
      )}
      {model.followUp === "contact" && <ContactLink />}
    </View>
  );
}

/** The order isn't the signed-in account's: say whose account this is. */
function OrderNotFound() {
  const locale = useAppLocale();
  const router = useRouter();
  const account = AsyncResult.value(useAtomValue(accountAtom));
  return (
    <Card>
      <EmptyState
        icon={Search}
        title={m.reservations_not_found_title({}, { locale })}
        body={Option.match(account, {
          onNone: () => m.reservations_order_not_found({}, { locale }),
          onSome: ({ email }) =>
            m.reservations_not_found_body({ email }, { locale }),
        })}
        live="polite"
      >
        <Button
          label={m.reservations_go_to_list({}, { locale })}
          onPress={() => router.dismissTo(reservationsHref)}
        />
        <Button
          variant="quiet"
          label={m.reservations_contact({}, { locale })}
          onPress={openContactPage}
        />
      </EmptyState>
    </Card>
  );
}

/** The first read found no order the account may see. */
const isNotFound = <E extends CustomerRequestFailure>(
  result: AsyncResult.AsyncResult<unknown, E>
) =>
  AsyncResult.isFailure(result) &&
  Option.isNone(AsyncResult.value(result)) &&
  CustomerViewError.$is("NotFound")(viewErrorOf(result.cause));

/**
 * An order as its booking ticket (GET status, which refreshes the order and
 * spends the read budget): where it stands, and the one thing to do next.
 * It keeps itself up to date while focused and in the foreground; pulling
 * down checks again once it has stopped checking on its own.
 */
export function OrderStatusScreen({
  orderId,
  visit,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly visit: StatusVisit;
}) {
  const locale = useAppLocale();
  const result = useAtomValue(orderStatusAtoms.status(orderId));
  const retry = useAtomRefresh(orderStatusAtoms.progress(orderId));
  const setFocus = useAtomSet(orderStatusAtoms.focus(orderId));
  const tap = useAtomSet(orderStatusAtoms.refreshRequests(orderId));

  useFocusEffect(
    useCallback(() => {
      setFocus(focusGained(visit));
      return () => setFocus(focusLost);
    }, [setFocus, visit])
  );

  // After a failed first read the refreshes have ended: start them again.
  const refresh = AsyncResult.isFailure(result)
    ? retry
    : () => tap((taps) => taps + 1);
  const refreshable = Option.match(AsyncResult.value(result), {
    onNone: () => AsyncResult.isFailure(result),
    onSome: canRefreshManually,
  });

  // Automatic reads show in the steps; the pull indicator is for the reads
  // the customer asked for.
  const pulled = Option.match(AsyncResult.value(result), {
    onNone: () => result.waiting,
    onSome: (state) =>
      state.reading && AutomaticRefresh.$is("Stopped")(state.automatic),
  });
  const shown = AsyncResult.isSuccess(result)
    ? AsyncResult.success(result.value, { waiting: pulled })
    : result;

  return (
    <ScrollScreen
      refreshing={pulled && !AsyncResult.isInitial(result)}
      onRefresh={refreshable ? refresh : undefined}
    >
      {isNotFound(result) ? (
        <OrderNotFound />
      ) : (
        <AsyncView
          result={shown}
          onRetry={retry}
          loading={
            <BookingTicketSkeleton
              label={m.account_loading({}, { locale })}
              stub="button"
            />
          }
        >
          {(state) => (
            <OrderTicket
              state={state}
              onCheckAgain={refresh}
              onPaymentPageLeft={() => setFocus(focusGained("after-payment"))}
            />
          )}
        </AsyncView>
      )}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  centred: { textAlign: "center" },
});
