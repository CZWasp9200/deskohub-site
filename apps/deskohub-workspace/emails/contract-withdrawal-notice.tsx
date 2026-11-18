import { Link, Section, Text } from "react-email";
import { m } from "@/features/i18n";
import { formatReservationDisplayDateTime } from "@/features/reservation/reservation-date";
import type { WithdrawalRefundBasis } from "@/features/withdrawal/withdrawal-assessment";
import { staffLocale } from "@/shared/backend/staff-locale";
import { formatMoney, type Money } from "@/shared/money/money";
import { emailWithBreak } from "@/shared/utils/email-with-break";
import { WithdrawalRefundBreakdown } from "./_components/withdrawal-refund-breakdown";
import {
  WorkspaceEmailHeading,
  WorkspaceEmailLabel,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { contractWithdrawalNoticePreviewProps } from "./_fixtures/preview-props";
import type { WorkspaceEmailDetail } from "./workspace-email-detail";

export type ContractWithdrawalNoticeEmailProps = {
  readonly contractLabel: string;
  /** The family's contract id, such as the reservation id. */
  readonly contractId: string;
  readonly accountId: string;
  /** The customer's name, when their profile has one. */
  readonly customerName: string | null;
  readonly customerEmail: string;
  readonly submittedAt: Temporal.Instant;
  readonly paidAmount: Money;
  readonly refundAmount: Money;
  readonly refundBasis: WithdrawalRefundBasis;
  /** The reservation in administration, where its payment is refunded. */
  readonly adminUrl: string;
  /**
   * When the reservation was cancelled, if it already was when this notice
   * went out; cancelling runs after the emails, so usually not yet.
   */
  readonly cancelledAt: Temporal.Instant | null;
};

/** The subject before the staff marker: what to do, then which contract. */
export const contractWithdrawalNoticeEmailSubject = ({
  contractLabel,
  refundAmount,
}: Pick<ContractWithdrawalNoticeEmailProps, "contractLabel" | "refundAmount">) =>
  refundAmount.value > 0
    ? m.withdrawalNoticeEmailSubject(
        {
          amount: formatMoney(refundAmount, staffLocale),
          contract: contractLabel,
        },
        { locale: staffLocale }
      )
    : m.withdrawalNoticeEmailSubjectNoRefund(
        { contract: contractLabel },
        { locale: staffLocale }
      );

const pragueTime = (instant: Temporal.Instant) =>
  m.withdrawalEmailPragueTime(
    { time: formatReservationDisplayDateTime(instant, staffLocale) },
    { locale: staffLocale }
  );

/**
 * Tells staff a customer withdrew online: the refund to send through Nexi
 * first, the way into administration, then the statement's details.
 */
export function ContractWithdrawalNoticeEmail(
  props: ContractWithdrawalNoticeEmailProps
) {
  const locale = staffLocale;
  const refunds = props.refundAmount.value > 0;
  const details: readonly WorkspaceEmailDetail[] = [
    {
      label: m.withdrawalNoticeCustomerLabel({}, { locale }),
      value: props.customerName ?? m.withdrawalNoticeNameMissing({}, { locale }),
    },
    {
      label: m.withdrawalEmailEmailLabel({}, { locale }),
      value: emailWithBreak(props.customerEmail),
    },
    {
      label: m.withdrawalEmailReferenceLabel({}, { locale }),
      value: props.contractId,
    },
    {
      label: m.withdrawalReceiptContractLabel({}, { locale }),
      value: props.contractLabel,
    },
    {
      label: m.withdrawalEmailSubmittedAtLabel({}, { locale }),
      value: pragueTime(props.submittedAt),
    },
    ...(props.refundBasis.kind === "full"
      ? [
          {
            label: m.withdrawalEmailPaidLabel({}, { locale }),
            value: formatMoney(props.paidAmount, locale),
          },
          {
            label: m.withdrawalNoticeRefundLabel({}, { locale }),
            value: formatMoney(props.refundAmount, locale),
          },
        ]
      : []),
    {
      label: m.withdrawalNoticeCancellationLabel({}, { locale }),
      value: props.cancelledAt
        ? m.withdrawalNoticeCancelledAt(
            { time: pragueTime(props.cancelledAt) },
            { locale }
          )
        : m.withdrawalNoticeCancellationPending({}, { locale }),
    },
  ];

  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={contractWithdrawalNoticeEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {m.withdrawalNoticeEmailHeading({}, { locale })}
      </WorkspaceEmailHeading>
      <Section className="mt-5 rounded-2xl bg-cream px-5 py-5">
        <WorkspaceEmailLabel>
          {m.withdrawalNoticeActionLabel({}, { locale })}
        </WorkspaceEmailLabel>
        <Text className="m-0 mt-2 text-[22px] font-bold leading-[28px] text-navy">
          {refunds
            ? m.withdrawalNoticeActionRefund(
                { amount: formatMoney(props.refundAmount, locale) },
                { locale }
              )
            : m.withdrawalNoticeActionNoRefund({}, { locale })}
        </Text>
        {refunds && (
          <Text className="m-0 mt-2 text-[14px] leading-[22px] text-[#565975]">
            {m.withdrawalNoticeActionHint({}, { locale })}
          </Text>
        )}
        <Link
          className="mt-4 inline-block rounded-full bg-navy px-6 py-3 text-[14px] font-bold leading-[20px] text-white no-underline"
          href={props.adminUrl}
          style={{ backgroundColor: "#00024f", color: "#ffffff" }}
        >
          {m.withdrawalNoticeOpenAdmin({}, { locale })}
        </Link>
      </Section>
      <WorkspaceEmailDetails details={details} wrapWords />
      <WithdrawalRefundBreakdown
        locale={locale}
        paidAmount={props.paidAmount}
        refundAmount={props.refundAmount}
        refundBasis={props.refundBasis}
        refundLabel={m.withdrawalNoticeRefundLabel({}, { locale })}
      />
    </WorkspaceEmailLayout>
  );
}

ContractWithdrawalNoticeEmail.PreviewProps =
  contractWithdrawalNoticePreviewProps;

export default ContractWithdrawalNoticeEmail;
