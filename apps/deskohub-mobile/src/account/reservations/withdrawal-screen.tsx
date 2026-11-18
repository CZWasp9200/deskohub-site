import type {
  CustomerReservationOrderId,
  CustomerWithdrawalQuote,
  CustomerWithdrawalReceipt,
  CustomerWithdrawalRefusedReason,
} from "@deskohub/workspace-customer-api";
import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Cause, Effect, Option, Predicate } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useRouter } from "expo-router";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import { reservationsHref } from "../../booking/booking-routes";
import { formatInstant, parseInstant } from "../../i18n/date-time-format";
import { emailWithBreak } from "../../ui/email-with-break";
import { Icon } from "../../ui/icon";
import { reservationHistoryAtom } from "./reservations-list-state";
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerRead, customerWrite } from "../../customer-api/customer-request";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { AsyncView } from "../../customer-api/async-view";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { formatMoney, formatMoneyReduction } from "../../i18n/money-format";
import { ActionFooter } from "../../ui/action-footer";
import { LoadingState } from "../../ui/async-states";
import { Card } from "../../ui/card";
import { Button, TextField } from "../../ui/controls";
import { EmptyState } from "../../ui/empty-state";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";

/** GET /reservations/:orderId/withdrawal, in the app's language. */
// Keyed by "<orderId> <locale>", so each order and language reads once.
const withdrawalQuoteAtom = Atom.family((key: string) => {
  const [orderId, locale] = key.split(" ") as [
    CustomerReservationOrderId,
    AppLocale,
  ];
  return customerDataRuntime.atom(
    Effect.service(CustomerApi).pipe(
      Effect.flatMap((api) =>
        api.reservations.getWithdrawalQuote({
          params: { orderId },
          query: { locale },
        })
      ),
      customerRead({ accountRead: false })
    )
  );
});

/** POST /reservations/:orderId/withdrawal: the "Confirm withdrawal". */
const withdrawAtom = customerDataRuntime.fn(
  ({
    orderId,
    locale,
  }: {
    readonly orderId: CustomerReservationOrderId;
    readonly locale: AppLocale;
  }) =>
    Effect.service(CustomerApi).pipe(
      Effect.flatMap((api) =>
        api.reservations.withdrawFromReservation({
          params: { orderId },
          payload: { locale },
        })
      ),
      customerWrite
    )
);

/** The reason the quote was refused, when it was. */
const refusalOf = (
  result: AsyncResult.AsyncResult<unknown, unknown>
): CustomerWithdrawalRefusedReason | undefined => {
  if (!AsyncResult.isFailure(result)) return undefined;
  return Option.match(Cause.findErrorOption(result.cause), {
    onNone: () => undefined,
    onSome: (failure) =>
      Predicate.isTagged(failure, "CustomerWithdrawalRefused") &&
      Predicate.hasProperty(failure, "reason")
        ? (failure.reason as CustomerWithdrawalRefusedReason)
        : undefined,
  });
};

/**
 * The withdrawal statement (§1830a(3)–(4)): the contract, the name and the
 * receipt email the customer confirms, what they get back, and a separate
 * "Confirm withdrawal". No reason, address or signature.
 */
export function WithdrawalScreen({
  orderId,
  reference,
}: {
  readonly orderId: CustomerReservationOrderId;
  /** The reservation number as the list shows it. */
  readonly reference: string;
}) {
  const locale = useAppLocale();
  const quoteAtom = withdrawalQuoteAtom(`${orderId} ${locale}`);
  const quote = useAtomValue(quoteAtom);
  const refresh = useAtomRefresh(quoteAtom);
  const refusal = refusalOf(quote);

  if (refusal !== undefined) return <WithdrawalRefused reason={refusal} />;
  if (AsyncResult.isInitial(quote))
    return <LoadingState label={m.withdrawal_loading({}, { locale })} />;
  return (
    <AsyncView result={quote} onRetry={refresh}>
      {(value) => (
        <WithdrawalStatement
          orderId={orderId}
          quote={value}
          reference={reference}
        />
      )}
    </AsyncView>
  );
}

function WithdrawalStatement({
  orderId,
  quote,
  reference,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly quote: CustomerWithdrawalQuote;
  readonly reference: string;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const [submission, withdraw] = useAtom(withdrawAtom);
  const pending = submission.waiting;

  // The name comes from the account; an input stands in only when it has none.
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const nameMissing =
    quote.customerName === null && submitted && name.trim() === "";
  const basis = quote.refundBasis;

  if (AsyncResult.isSuccess(submission))
    return (
      <WithdrawalReceived
        quote={quote}
        receipt={submission.value}
        reference={reference}
      />
    );

  const confirm = () => {
    setSubmitted(true);
    if (quote.customerName === null && name.trim() === "") return;
    withdraw({ orderId, locale });
  };

  return (
    <View style={styles.screen}>
      <ScrollScreen>
        <View style={styles.stack}>
          <Card padding="none">
            <DetailRow label={m.withdrawal_reference({}, { locale })}>
              <Text numeric variant="bodyStrong">
                {reference}
              </Text>
            </DetailRow>
            <DetailRow divided label={m.withdrawal_contract({}, { locale })}>
              <Text variant="bodyStrong">{quote.contractLabel}</Text>
            </DetailRow>
            {quote.customerName !== null && (
              <DetailRow divided label={m.withdrawal_name({}, { locale })}>
                <Text variant="bodyStrong">{quote.customerName}</Text>
              </DetailRow>
            )}
            {quote.customerName === null && (
              <View style={[styles.detail, styles.divided]}>
                <TextField
                  label={m.withdrawal_name_input({}, { locale })}
                  value={name}
                  onChangeText={setName}
                  autoComplete="name"
                  disabled={pending}
                  error={
                    nameMissing
                      ? m.withdrawal_name_required({}, { locale })
                      : undefined
                  }
                />
              </View>
            )}
            <DetailRow divided label={m.withdrawal_receipt_to({}, { locale })}>
              <Text variant="bodyStrong">{quote.receiptEmail}</Text>
            </DetailRow>
          </Card>

          <Card>
            <View style={styles.amountRow}>
              <Text variant="body">{m.withdrawal_paid({}, { locale })}</Text>
              <Text numeric variant="body" style={styles.amount}>
                {formatMoney(quote.paidAmount, locale)}
              </Text>
            </View>
            {basis.kind === "partial" && (
              <View style={styles.amountRow}>
                <Text variant="bodySmall" style={styles.muted}>
                  {(basis.unit === "hour"
                    ? m.withdrawal_started_hours
                    : m.withdrawal_started_days)(
                    {
                      started: basis.total - basis.unstarted,
                      total: basis.total,
                    },
                    { locale }
                  )}
                </Text>
                <Text
                  numeric
                  variant="bodySmall"
                  style={[styles.amount, styles.muted]}
                >
                  {formatMoneyReduction(
                    {
                      ...quote.paidAmount,
                      value: quote.paidAmount.value - quote.refundAmount.value,
                    },
                    locale
                  )}
                </Text>
              </View>
            )}
            <View style={[styles.amountRow, styles.totalRow]}>
              <Text variant="bodyStrong">
                {m.withdrawal_refund({}, { locale })}
              </Text>
              <Text numeric variant="bodyStrong" style={styles.amount}>
                {formatMoney(quote.refundAmount, locale)}
              </Text>
            </View>
            <Text variant="hint" style={styles.note}>
              {m.withdrawal_refund_note({}, { locale })}
            </Text>
          </Card>
        </View>
      </ScrollScreen>
      <ActionFooter>
        <Button
          variant="positive"
          label={m.withdrawal_decline({}, { locale })}
          disabled={pending}
          onPress={() => router.back()}
        />
        <Button
          variant="danger"
          label={m.withdrawal_confirm({}, { locale })}
          busy={pending}
          disabled={pending}
          onPress={confirm}
        />
      </ActionFooter>
    </View>
  );
}

/** A read-only line of the statement: what it is, then its value. */
function DetailRow({
  label,
  divided = false,
  children,
}: {
  readonly label: string;
  readonly divided?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <View style={[styles.detail, divided && styles.divided]}>
      <Text variant="caption">{label}</Text>
      {children}
    </View>
  );
}

/** Why the customer can't withdraw now, with the way back. */
function WithdrawalRefused({
  reason,
}: {
  readonly reason: CustomerWithdrawalRefusedReason;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const body =
    reason === "period_ended"
      ? m.withdrawal_refused_period_ended({}, { locale })
      : reason === "already_withdrawn"
        ? m.withdrawal_refused_already({}, { locale })
        : m.withdrawal_refused_other({}, { locale });
  return (
    <View style={styles.screen}>
      <ScrollScreen>
        <EmptyState
          icon={CircleAlert}
          title={m.withdrawal_refused_title({}, { locale })}
          body={body}
          live="polite"
        />
      </ScrollScreen>
      <ActionFooter>
        <Button
          variant="secondary"
          label={m.withdrawal_back({}, { locale })}
          onPress={() => router.back()}
        />
      </ActionFooter>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  stack: { gap: space.lg },
  detail: { gap: 2, paddingHorizontal: space.lg, paddingVertical: 14 },
  divided: { borderTopColor: color.divider, borderTopWidth: 1 },
  amountRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: space.lg,
    justifyContent: "space-between",
    paddingVertical: space.xs,
  },
  amount: { flexShrink: 0, textAlign: "right" },
  muted: { color: color.ink2 },
  totalRow: {
    borderTopColor: color.divider,
    borderTopWidth: 1,
    marginTop: space.sm,
    paddingTop: space.md,
  },
  note: { marginTop: space.xs },
  receivedHead: { alignItems: "center", gap: space.lg, paddingTop: space.md },
  receivedIcon: {
    alignItems: "center",
    backgroundColor: color.positiveTint,
    borderRadius: 999,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  receivedTitle: { textAlign: "center" },
});

/**
 * The receipt of a submitted withdrawal (§1830a(5)): what, when, and the
 * refund. It replaces the statement, so going back never returns to it.
 */
function WithdrawalReceived({
  quote,
  receipt,
  reference,
}: {
  readonly quote: CustomerWithdrawalQuote;
  readonly receipt: CustomerWithdrawalReceipt;
  readonly reference: string;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const refreshHistory = useAtomRefresh(reservationHistoryAtom);
  const close = () => {
    refreshHistory();
    router.dismissTo(reservationsHref);
  };
  const submitted = Option.match(parseInstant(receipt.submittedAt), {
    onNone: () => receipt.submittedAt,
    onSome: (instant) => formatInstant(instant, locale, "date-time"),
  });
  return (
    <View style={styles.screen}>
      <ScrollScreen>
        <View style={styles.stack}>
          <View style={styles.receivedHead}>
            <View style={styles.receivedIcon}>
              <Icon icon={CircleCheck} size={36} color={color.positiveInk} />
            </View>
            <Text variant="titleLarge" role="heading" style={styles.receivedTitle}>
              {m.withdrawal_received_title({}, { locale })}
            </Text>
          </View>
          <Card padding="none">
            <DetailRow label={m.withdrawal_reference({}, { locale })}>
              <Text numeric variant="bodyStrong">
                {reference}
              </Text>
            </DetailRow>
            <DetailRow divided label={m.withdrawal_contract({}, { locale })}>
              <Text variant="bodyStrong">{quote.contractLabel}</Text>
            </DetailRow>
            <DetailRow divided label={m.withdrawal_submitted({}, { locale })}>
              <Text numeric variant="bodyStrong">
                {submitted}
              </Text>
            </DetailRow>
            <DetailRow divided label={m.withdrawal_refund({}, { locale })}>
              <Text numeric variant="bodyStrong">
                {formatMoney(receipt.refundAmount, locale)}
              </Text>
            </DetailRow>
          </Card>
          {/* Simple breaking keeps the address whole; Android's default
              strategy breaks it at a dot. */}
          <Text variant="bodySmall" textBreakStrategy="simple">
            {m.withdrawal_received_emailed(
              {
                email: emailWithBreak(receipt.receiptEmail),
              },
              { locale }
            )}
          </Text>
        </View>
      </ScrollScreen>
      <ActionFooter>
        <Button
          variant="primary"
          label={m.withdrawal_close({}, { locale })}
          onPress={close}
        />
      </ActionFooter>
    </View>
  );
}
