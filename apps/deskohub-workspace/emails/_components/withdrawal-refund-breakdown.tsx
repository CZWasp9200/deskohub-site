import { Column, Row, Section, Text } from "react-email";
import { type Locale, m } from "@/features/i18n";
import type { WithdrawalRefundBasis } from "@/features/withdrawal/withdrawal-assessment";
import { formatMoney, type Money } from "@/shared/money/money";

/**
 * What a partial withdrawal refund keeps back: paid, the days or hours
 * already started, and the refund in bold. Nothing for a full refund.
 */
export function WithdrawalRefundBreakdown({
  locale,
  paidAmount,
  refundAmount,
  refundBasis,
  refundLabel,
}: {
  readonly locale: Locale;
  readonly paidAmount: Money;
  readonly refundAmount: Money;
  readonly refundBasis: WithdrawalRefundBasis;
  /** "We'll refund" to the customer, "Refund" to staff. */
  readonly refundLabel: string;
}) {
  if (refundBasis.kind !== "partial") return null;
  const kept = { ...paidAmount, value: paidAmount.value - refundAmount.value };
  const started = (
    refundBasis.unit === "hour"
      ? m.withdrawalStartedHours
      : m.withdrawalStartedDays
  )(
    {
      started: refundBasis.total - refundBasis.unstarted,
      total: refundBasis.total,
    },
    { locale }
  );
  const line = (label: string, amount: string, muted: boolean) => (
    <Row>
      <Column className="py-1 align-top">
        <Text
          className={`m-0 text-[14px] leading-[22px] ${muted ? "text-[#565975]" : "text-navy"}`}
        >
          {label}
        </Text>
      </Column>
      <Column className="py-1 text-right align-top">
        <Text
          className={`m-0 whitespace-nowrap text-[14px] leading-[22px] ${muted ? "text-[#565975]" : "text-navy"}`}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {amount}
        </Text>
      </Column>
    </Row>
  );
  return (
    <Section className="mt-4 rounded-2xl border border-[#e6e9f3] px-4 py-3">
      {line(
        m.withdrawalPaidAmount({}, { locale }),
        formatMoney(paidAmount, locale),
        false
      )}
      {line(started, `−${formatMoney(kept, locale)}`, true)}
      <Row style={{ borderTop: "1px solid #e6e9f3" }}>
        <Column className="pt-3 align-top">
          <Text className="m-0 text-[15px] font-bold leading-[22px] text-navy">
            {refundLabel}
          </Text>
        </Column>
        <Column className="pt-3 text-right align-top">
          <Text
            className="m-0 whitespace-nowrap text-[15px] font-bold leading-[22px] text-navy"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatMoney(refundAmount, locale)}
          </Text>
        </Column>
      </Row>
    </Section>
  );
}
