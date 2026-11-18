import type {
  CustomerReservationOrderId,
  CustomerWithdrawalQuote,
  CustomerWithdrawalReceipt,
  CustomerWithdrawalRefusedReason,
} from "@deskohub/workspace-customer-api";
import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { useRouter } from "expo-router";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import { reservationsHref } from "../../booking/booking-routes";
import {
  type CustomerViewError,
  isRetryableViewError,
} from "../../customer-api/customer-view-error";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import { formatInstant, parseInstant } from "../../i18n/date-time-format";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { formatMoney, formatMoneyReduction } from "../../i18n/money-format";
import { ActionFooter } from "../../ui/action-footer";
import { ErrorState, LoadingState } from "../../ui/async-states";
import { Card } from "../../ui/card";
import { Button, TextField } from "../../ui/controls";
import { emailWithBreak } from "../../ui/email-with-break";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";
import {
  type WithdrawalNameField,
  WithdrawalScreenState,
  withdrawAtom,
  withdrawalQuoteAtom,
  withdrawalQuoteKey,
  withdrawalScreenState,
  withdrawalSubmission,
} from "./withdrawal-screen-state";

/**
 * The online withdrawal's confirm step: the statement, then its receipt in
 * place, or why the order can't be withdrawn from online.
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
  const quoteAtom = withdrawalQuoteAtom(withdrawalQuoteKey(orderId, locale));
  const quote = useAtomValue(quoteAtom);
  const refreshQuote = useAtomRefresh(quoteAtom);
  const [submission, withdraw] = useAtom(withdrawAtom(orderId));
  // The name comes from the account; an input stands in only when it has none.
  const [typedName, setTypedName] = useState("");
  const [nameAttempted, setNameAttempted] = useState(false);
  const state = withdrawalScreenState({
    quote,
    submission,
    typedName,
    nameAttempted,
  });

  return WithdrawalScreenState.$match(state, {
    Loading: () => (
      <LoadingState label={m.withdrawal_loading({}, { locale })} />
    ),
    QuoteFailed: ({ error }) => (
      <WithdrawalUnavailable
        error={error}
        retrying={quote.waiting}
        onRetry={refreshQuote}
      />
    ),
    Refused: ({ reason }) => <WithdrawalRefused reason={reason} />,
    Received: ({ quote, receipt }) => (
      <WithdrawalReceived
        quote={quote}
        receipt={receipt}
        reference={reference}
      />
    ),
    Statement: ({ quote, name, pending, failure }) => (
      <WithdrawalStatement
        quote={quote}
        reference={reference}
        name={name}
        typedName={typedName}
        onNameChange={setTypedName}
        pending={pending}
        failure={failure}
        onConfirm={() => {
          setNameAttempted(true);
          Option.map(withdrawalSubmission(name, typedName, locale), withdraw);
        }}
      />
    ),
  });
}

/**
 * The withdrawal statement (§1830a(3)–(4)): the contract, the name and the
 * receipt email the customer confirms, what they get back, and a separate
 * "Confirm withdrawal". No reason, address or signature.
 */
function WithdrawalStatement({
  quote,
  reference,
  name,
  typedName,
  onNameChange,
  pending,
  failure,
  onConfirm,
}: {
  readonly quote: CustomerWithdrawalQuote;
  readonly reference: string;
  readonly name: WithdrawalNameField;
  readonly typedName: string;
  readonly onNameChange: (name: string) => void;
  readonly pending: boolean;
  readonly failure: Option.Option<CustomerViewError>;
  readonly onConfirm: () => void;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const basis = quote.refundBasis;
  return (
    <View style={styles.screen}>
      <ScrollScreen>
        <View style={styles.stack}>
          {/* Kept mounted so assistive tech announces a failed confirmation. */}
          <Notice
            tone="error"
            message={Option.match(failure, {
              onNone: () => undefined,
              onSome: (error) =>
                sharedViewErrorMessage(error, locale) ??
                m.account_error_unexpected({}, { locale }),
            })}
          />
          <Card padding="none">
            <DetailRow label={m.withdrawal_reference({}, { locale })}>
              <Text numeric variant="bodyStrong">
                {reference}
              </Text>
            </DetailRow>
            <DetailRow divided label={m.withdrawal_contract({}, { locale })}>
              <Text variant="bodyStrong">{quote.contractLabel}</Text>
            </DetailRow>
            {name.kind === "known" ? (
              <DetailRow divided label={m.withdrawal_name({}, { locale })}>
                <Text variant="bodyStrong">{name.name}</Text>
              </DetailRow>
            ) : (
              <View style={[styles.detail, styles.divided]}>
                <TextField
                  label={m.withdrawal_name_input({}, { locale })}
                  value={typedName}
                  onChangeText={onNameChange}
                  autoComplete="name"
                  disabled={pending}
                  error={
                    name.missing
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
          variant="danger"
          label={m.withdrawal_confirm({}, { locale })}
          busy={pending}
          disabled={pending}
          onPress={onConfirm}
        />
        <Button
          variant="positive"
          label={m.withdrawal_decline({}, { locale })}
          disabled={pending}
          onPress={() => router.back()}
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

/** The quote didn't load: the shared failure copy, with a retry when it can help. */
function WithdrawalUnavailable({
  error,
  retrying,
  onRetry,
}: {
  readonly error: CustomerViewError;
  readonly retrying: boolean;
  readonly onRetry: () => void;
}) {
  const locale = useAppLocale();
  const message =
    sharedViewErrorMessage(error, locale) ??
    m.account_error_unexpected({}, { locale });
  return (
    <View style={styles.screen}>
      <ScrollScreen>
        {isRetryableViewError(error) ? (
          <ErrorState
            message={message}
            retryLabel={m.account_retry({}, { locale })}
            onRetry={onRetry}
            retrying={retrying}
          />
        ) : (
          <Notice tone="error" message={message} />
        )}
      </ScrollScreen>
    </View>
  );
}

/** The refusals with their own sentence; the others share one. */
const refusalMessages: Partial<
  Record<CustomerWithdrawalRefusedReason, typeof m.withdrawal_refused_other>
> = {
  period_ended: m.withdrawal_refused_period_ended,
  already_withdrawn: m.withdrawal_refused_already,
};

/** Why the customer can't withdraw now, with the way back. */
function WithdrawalRefused({
  reason,
}: {
  readonly reason: CustomerWithdrawalRefusedReason;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const body = (refusalMessages[reason] ?? m.withdrawal_refused_other)(
    {},
    { locale }
  );
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
  // The confirmation already read the list again; closing returns to it.
  const close = () => router.dismissTo(reservationsHref);
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
            <Text
              variant="titleLarge"
              role="heading"
              style={styles.receivedTitle}
            >
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
