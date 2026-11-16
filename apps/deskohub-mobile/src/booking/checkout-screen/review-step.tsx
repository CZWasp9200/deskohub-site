import type {
  CustomerBookingSelection,
  CustomerLegalDocument,
} from "@deskohub/workspace-customer-api";
import { DateTime, Option } from "effect";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Lock from "lucide-react-native/icons/lock";
import Tag from "lucide-react-native/icons/tag";
import X from "lucide-react-native/icons/x";
import { type ComponentRef, type ReactNode, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { DateTile } from "../../account/reservations/booking-ticket";
import { dateTileParts } from "../../account/reservations/booking-time";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import { upperFirst } from "../../i18n/sentence-case";
import { theme } from "../../theme";
import { ErrorState, LoadingState } from "../../ui/async-states";
import { Card } from "../../ui/card";
import { Button, TextField } from "../../ui/controls";
import { Icon } from "../../ui/icon";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { Notice } from "../../ui/notice";
import { Text } from "../../ui/text";
import { color, radius, space, touchTarget } from "../../ui/tokens";
import { useKeyboardShown } from "../../ui/use-keyboard-shown";
import type { CheckoutIntent } from "../checkout/checkout-flow";
import {
  CheckoutEvent,
  type ReviewNotice,
  type ReviewState,
} from "../checkout/checkout-state";
import { type PragueDate, pragueMidnight } from "../selection/prague-date";
import { BookingBar, type BookingBarAction } from "../ui/booking-bar";
import { BookingSectionHeading } from "../ui/booking-section-heading";
import { BookingSteps } from "../ui/booking-steps";
import { bookingSummaryParts } from "../ui/booking-summary";
import { Checkbox } from "../ui/checkbox";
import { useHoldCountdown } from "../ui/hold-timer";
import { describePriceLine } from "../ui/price-line-description";
import { PriceLines } from "../ui/price-lines";
import { bookingOverviewOf } from "./booking-overview";
import { productLabel, retryMessage } from "./checkout-copy";
import {
  type CodeFieldView,
  type CodeProblem,
  type ConsentView,
  type PriceChangeView,
  type ReviewInvoice,
  type ReviewParty,
  type ReviewView,
  reviewView,
} from "./review-view";

type Send = (intent: CheckoutIntent) => void;
type Locale = { readonly locale: AppLocale };

/**
 * The held order before payment (boards 32 and 33): what is booked, when
 * and for whom with Change, the server's price lines once each, the code
 * row, the agreement, and the booking bar's Pay. Under a minute left, a
 * pinned warning says what happens at 0:00. The hold timer chip sits in the
 * app bar (`CheckoutScreen`).
 */
export function ReviewStep({
  review,
  selection,
  quotedTotal,
  bookerName,
  send,
  onChangeBooking,
  onOpenDocument,
  keyboardOffset = 0,
  locale,
}: Locale & {
  readonly review: ReviewState;
  readonly selection: CustomerBookingSelection;
  /** The total the selection screen quoted. */
  readonly quotedTotal: ReviewView["price"]["breakdown"]["total"];
  /** The account's own name, for "Booked by". */
  readonly bookerName: Option.Option<string>;
  readonly send: Send;
  /** Back to the selection, with the choices kept. */
  readonly onChangeBooking: () => void;
  readonly onOpenDocument: (document: CustomerLegalDocument) => void;
  /** The height above the step, such as the stack header's. */
  readonly keyboardOffset?: number;
}) {
  const view = reviewView(review, quotedTotal, bookerName);
  const hold = useHoldCountdown(view.holdExpiresAt);
  const keyboardShown = useKeyboardShown();
  const [raised, setRaised] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={keyboardOffset}
      style={styles.screen}
    >
      <BookingSteps current="pay" raised={raised} locale={locale} />
      {hold.phase === "ending" && (
        <View style={styles.banner}>
          <Notice
            tone="warning"
            title={m.booking_review_last_minute_title({}, { locale })}
            message={m.booking_review_last_minute_body({}, { locale })}
          />
        </View>
      )}
      <ScrollView
        ref={scroll}
        style={styles.body}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={({ nativeEvent }) =>
          setRaised(nativeEvent.contentOffset.y > 0)
        }
      >
        <BookingSectionHeading
          title={m.booking_review_booking_heading({}, { locale })}
          action={{
            label: m.booking_review_change({}, { locale }),
            onPress: onChangeBooking,
            disabled: view.busy,
          }}
          first
        />
        <BookingCard
          selection={selection}
          earlySetup={review.flow.earlySetup === true}
          party={view.party}
          invoice={view.invoice}
          locale={locale}
        />
        <BookingSectionHeading
          title={m.booking_review_price_heading({}, { locale })}
        />
        <Card padding="none">
          <View style={styles.priceCard}>
            {Option.isSome(view.priceChange) && (
              <PriceChange
                change={view.priceChange.value}
                busy={view.busy}
                send={send}
                onChangeBooking={onChangeBooking}
                locale={locale}
              />
            )}
            <PriceLines
              breakdown={view.price.breakdown}
              describeLine={describePriceLine(selection, locale)}
              locale={locale}
              variant="card"
              total={{
                label: m.booking_review_total({}, { locale }),
                was: Option.getOrUndefined(view.price.was),
              }}
            />
          </View>
        </Card>
        <View style={styles.code}>
          <CodeRow code={view.code} send={send} locale={locale} />
        </View>
        <LegalConsent
          consent={view.consent}
          send={send}
          onOpenDocument={onOpenDocument}
          locale={locale}
        />
        <ReviewNoticeView
          notice={review.notice}
          idle={!view.busy}
          send={send}
          locale={locale}
        />
      </ScrollView>
      <BookingBar
        locale={locale}
        action={payAction(view, send, locale)}
        // With the keyboard up only the button rides above it.
        reason={
          keyboardShown
            ? undefined
            : Option.match(view.payBlock, {
                onNone: () => undefined,
                onSome: (block) =>
                  block === "AcceptPrice"
                    ? m.booking_review_pay_reason_accept_price({}, { locale })
                    : m.booking_review_pay_reason_agreement({}, { locale }),
              })
        }
      />
    </KeyboardAvoidingView>
  );
}

/**
 * Pay, the seam the payment ticket (#1253) builds on: it submits the
 * checkout, which opens the payment page.
 */
const payAction = (
  view: ReviewView,
  send: Send,
  locale: AppLocale
): BookingBarAction => ({
  label: view.submitting
    ? m.booking_checkout_paying({}, { locale })
    : m.booking_checkout_pay(
        { amount: formatMoney(view.price.breakdown.total, locale) },
        { locale }
      ),
  onPress: () => send(CheckoutEvent.Pay()),
  disabled: !view.canPay,
  busy: view.submitting,
  icon: view.canPay ? Lock : undefined,
});

/** The booking's first day as a date tile. */
const startDay = (selection: CustomerBookingSelection, earlySetup: boolean) => {
  const overview = bookingOverviewOf(selection, earlySetup);
  return overview._tag === "Office" ? overview.firstDate : overview.date;
};

/** What, when, for whom and the invoice (`.bk-card` with `what_block`). */
function BookingCard({
  selection,
  earlySetup,
  party,
  invoice,
  locale,
}: Locale & {
  readonly selection: CustomerBookingSelection;
  readonly earlySetup: boolean;
  readonly party: ReviewParty;
  readonly invoice: ReviewInvoice;
}) {
  const summary = bookingSummaryParts(selection, locale);
  const you = (name: string) => m.booking_review_you({ name }, { locale });
  return (
    <Card padding="none">
      <View style={styles.bookingCard}>
        <View style={styles.what}>
          <DateTile
            parts={dateTileParts(
              pragueDateTime(startDay(selection, earlySetup)),
              locale
            )}
          />
          <View style={styles.whatText}>
            <Text variant="bodyStrong" role="heading">
              {productLabel(selection, locale)}
            </Text>
            <Text variant="bodySmall" tone="muted">
              {summary.title}
            </Text>
            {summary.extras.length > 0 && (
              <Text variant="bodySmall" tone="muted">
                {upperFirst(summary.extras.join(", "), locale)}
              </Text>
            )}
          </View>
        </View>
        {party._tag === "Self" ? (
          <Row label={m.booking_review_for({}, { locale })}>
            <Text variant="bodySmall" style={styles.end}>
              {you(party.name)}
            </Text>
          </Row>
        ) : (
          <>
            <Row label={m.booking_review_for({}, { locale })}>
              <Text variant="bodySmall" style={styles.end}>
                {party.name}
              </Text>
              <Text variant="caption" tone="muted" style={styles.end}>
                {party.email}
              </Text>
              <Text variant="caption" tone="muted" style={styles.end}>
                {m.booking_review_gets_pin({}, { locale })}
              </Text>
            </Row>
            {Option.isSome(party.bookerName) && (
              <Row label={m.booking_review_booked_by({}, { locale })}>
                <Text variant="bodySmall" style={styles.end}>
                  {you(party.bookerName.value)}
                </Text>
              </Row>
            )}
          </>
        )}
        <Row label={m.booking_details_invoice_heading({}, { locale })}>
          <Text variant="bodySmall" style={styles.end}>
            {invoiceText(invoice, locale)}
          </Text>
        </Row>
      </View>
    </Card>
  );
}

const pragueDateTime = (date: PragueDate) =>
  DateTime.makeUnsafe(pragueMidnight(date));

const invoiceText = (invoice: ReviewInvoice, locale: AppLocale) => {
  switch (invoice._tag) {
    case "None":
      return m.booking_details_invoice_none({}, { locale });
    case "Personal":
      return m.booking_review_invoice_to_you(
        { city: invoice.city },
        { locale }
      );
    case "Company":
      return invoice.legalName;
  }
};

/** A label and its value on the right, wrapping under it when narrow. */
function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text variant="bodySmall" tone="muted" style={styles.rowLabel}>
        {label}
      </Text>
      <View style={styles.rowValue}>{children}</View>
    </View>
  );
}

/**
 * A changed price to accept (board 33b): the quote's total and the new one,
 * Accept, or back to the selection.
 */
function PriceChange({
  change,
  busy,
  send,
  onChangeBooking,
  locale,
}: Locale & {
  readonly change: PriceChangeView;
  readonly busy: boolean;
  readonly send: Send;
  readonly onChangeBooking: () => void;
}) {
  const now = formatMoney(change.now, locale);
  return (
    <View style={styles.priceChange}>
      <Notice
        tone="warning"
        title={m.booking_review_price_changed_title({}, { locale })}
        message={m.booking_review_price_changed_body(
          { before: formatMoney(change.before, locale), now },
          { locale }
        )}
      />
      <View style={styles.priceChangeActions}>
        <Button
          label={m.booking_review_accept_price({ amount: now }, { locale })}
          onPress={() => send(CheckoutEvent.AcceptPrice())}
          busy={change.accepting}
          disabled={busy}
          variant="secondary"
          size="small"
          width="content"
        />
        <Button
          label={m.booking_review_change_booking({}, { locale })}
          onPress={onChangeBooking}
          disabled={busy}
          variant="quiet"
          size="small"
          width="content"
        />
      </View>
    </View>
  );
}

/**
 * The code row: the applied code's chip, the quiet row that opens the
 * field, or the field with Apply beside it and its problem under both.
 */
function CodeRow({
  code,
  send,
  locale,
}: Locale & { readonly code: CodeFieldView; readonly send: Send }) {
  return code._tag === "Applied" ? (
    <AppliedCode code={code} send={send} locale={locale} />
  ) : (
    <CodeEntry code={code} send={send} locale={locale} />
  );
}

function AppliedCode({
  code,
  send,
  locale,
}: Locale & {
  readonly code: Extract<CodeFieldView, { readonly _tag: "Applied" }>;
  readonly send: Send;
}) {
  return (
    <View role="status" style={styles.applied}>
      <Icon icon={CircleCheck} size={20} color={color.positiveInk} />
      <Text variant="bodyStrong" style={styles.appliedText}>
        {m.booking_review_code_applied({ code: code.code }, { locale })}
      </Text>
      {code.clearing ? (
        <View style={styles.remove}>
          <LoadingIndicator size="inline" tone="navy" />
        </View>
      ) : (
        code.canClear && (
          <Pressable
            role="button"
            aria-label={m.booking_review_remove_code(
              { code: code.code },
              { locale }
            )}
            onPress={() => send(CheckoutEvent.ClearCode())}
            style={styles.remove}
          >
            <Icon icon={X} size={20} color={color.positiveInk} />
          </Pressable>
        )
      )}
    </View>
  );
}

function CodeEntry({
  code,
  send,
  locale,
}: Locale & {
  readonly code: Extract<CodeFieldView, { readonly _tag: "Entry" }>;
  readonly send: Send;
}) {
  const [opened, setOpened] = useState(false);
  if (!opened && !code.startsOpen) {
    return (
      <Pressable
        role="button"
        onPress={() => setOpened(true)}
        disabled={!code.editable}
        style={styles.addRow}
      >
        <Icon icon={Tag} size={20} color={color.action} />
        <Text variant="bodyStrong" tone="action" style={styles.addRowText}>
          {m.booking_review_add_code({}, { locale })}
        </Text>
      </Pressable>
    );
  }
  const problem = Option.getOrUndefined(code.problem);
  return (
    <TextField
      label={m.booking_checkout_code_label({}, { locale })}
      value={code.input}
      onChangeText={(input) => send(CheckoutEvent.CodeChanged({ input }))}
      onSubmitEditing={() => send(CheckoutEvent.ApplyCode())}
      editable={code.editable}
      autoCapitalize="characters"
      autoFocus={opened}
      returnKeyType="done"
      error={
        problem && problem._tag !== "AwaitingPriceAcceptance"
          ? codeProblemText(problem, locale)
          : undefined
      }
      hint={
        problem?._tag === "AwaitingPriceAcceptance"
          ? codeProblemText(problem, locale)
          : undefined
      }
      accessory={
        <Button
          label={m.booking_checkout_code_apply({}, { locale })}
          onPress={() => send(CheckoutEvent.ApplyCode())}
          disabled={!code.canApply}
          busy={code.applying}
          variant="secondary"
          width="content"
        />
      }
    />
  );
}

const codeProblemText = (problem: CodeProblem, locale: AppLocale): string => {
  switch (problem._tag) {
    case "AwaitingPriceAcceptance":
      return m.booking_checkout_code_awaiting_price({}, { locale });
    case "Retryable":
      return m.booking_checkout_code_unavailable({}, { locale });
    case "Rejected":
      return {
        already_attributed: () =>
          m.booking_checkout_code_already_attributed({}, { locale }),
        ineligible: () => m.booking_checkout_code_ineligible({}, { locale }),
        code_already_applied: () =>
          m.booking_checkout_code_already_applied({}, { locale }),
      }[problem.reason]();
  }
};

// The agreement and its documents belong to the payment ticket (#1253);
// kept as they were.
function LegalConsent({
  consent,
  send,
  onOpenDocument,
  locale,
}: Locale & {
  readonly consent: ConsentView;
  readonly send: Send;
  readonly onOpenDocument: (document: CustomerLegalDocument) => void;
}) {
  const { legal } = consent;
  switch (legal._tag) {
    case "Loading":
      return (
        <LoadingState
          label={m.booking_checkout_legal_loading({}, { locale })}
        />
      );
    case "Failed":
      return (
        <ErrorState
          message={m.booking_checkout_legal_failed({}, { locale })}
          retryLabel={m.booking_checkout_retry({}, { locale })}
          onRetry={() => send(CheckoutEvent.ReloadLegalDocuments())}
        />
      );
    case "Loaded":
      return (
        <Checkbox
          label={
            consent.earlyPerformance
              ? m.booking_checkout_legal_consent_early_performance(
                  {},
                  { locale }
                )
              : m.booking_checkout_legal_consent({}, { locale })
          }
          checked={consent.checked}
          onChange={(accepted) =>
            send(CheckoutEvent.ToggleConsent({ accepted }))
          }
          disabled={consent.disabled}
        >
          <View style={styles.links}>
            {legal.documents.map((document) => (
              <Pressable
                key={document.key}
                role="link"
                onPress={() => onOpenDocument(document)}
                style={styles.link}
              >
                <Text style={styles.linkText}>
                  {{
                    "terms-and-conditions": () =>
                      m.booking_checkout_legal_terms({}, { locale }),
                    "operating-rules": () =>
                      m.booking_checkout_legal_operating_rules({}, { locale }),
                  }[document.key]()}
                </Text>
              </Pressable>
            ))}
          </View>
        </Checkbox>
      );
  }
}

function ReviewNoticeView({
  notice,
  idle,
  send,
  locale,
}: Locale & {
  readonly notice: Option.Option<ReviewNotice>;
  readonly idle: boolean;
  readonly send: Send;
}) {
  const shown = Option.getOrUndefined(notice);
  return (
    <View style={styles.group}>
      <Notice
        tone="error"
        message={shown && reviewNoticeMessage(shown, locale)}
      />
      {shown?._tag === "Retryable" && (
        <Button
          label={m.booking_checkout_retry({}, { locale })}
          onPress={() => send(CheckoutEvent.Retry())}
          disabled={!idle}
          variant="secondary"
        />
      )}
    </View>
  );
}

const reviewNoticeMessage = (notice: ReviewNotice, locale: AppLocale) => {
  switch (notice._tag) {
    case "Retryable":
      return retryMessage(notice.kind, locale);
    case "ConsentRequired":
      return notice.consent === "early_performance"
        ? m.booking_checkout_consent_required_early_performance({}, { locale })
        : m.booking_checkout_consent_required({}, { locale });
    case "LegalDocumentsChanged":
      return m.booking_checkout_legal_changed({}, { locale });
  }
};

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  banner: {
    backgroundColor: color.paper,
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    paddingBottom: space.sm,
    paddingHorizontal: space.gutter,
  },
  body: { flex: 1 },
  content: {
    gap: 0,
    paddingBottom: space.xxl,
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
  },
  bookingCard: {
    paddingBottom: space.xs,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  what: { flexDirection: "row", gap: space.md, paddingBottom: space.sm },
  whatText: { flex: 1, gap: 2, minWidth: 0 },
  row: {
    borderTopColor: color.line,
    borderTopWidth: 1,
    columnGap: space.md,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingVertical: space.md,
  },
  rowLabel: { flexShrink: 0 },
  rowValue: { alignItems: "flex-end", flexGrow: 1, flexShrink: 1 },
  end: { textAlign: "right" },
  priceCard: { gap: space.lg, padding: space.lg },
  priceChange: { gap: space.md },
  priceChangeActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
  },
  code: { marginTop: space.sm },
  addRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.xs,
  },
  addRowText: { flexShrink: 1 },
  applied: {
    alignItems: "center",
    backgroundColor: color.positiveTint,
    borderRadius: radius.field,
    flexDirection: "row",
    gap: 10,
    minHeight: 52,
    paddingLeft: 14,
    paddingRight: 2,
    paddingVertical: 2,
  },
  appliedText: { color: color.positiveInk, flex: 1 },
  remove: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  group: { gap: theme.spacing.sm, marginTop: space.lg },
  links: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
  link: { minHeight: theme.touchTarget, justifyContent: "center" },
  linkText: {
    ...theme.type.caption,
    color: theme.colors.accent,
    textDecorationLine: "underline",
  },
});
