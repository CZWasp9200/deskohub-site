import { type Locale, m } from "@/features/i18n";
import { formatReservationDisplayDateTime } from "@/features/reservation/reservation-date";
import type { WithdrawalRefundBasis } from "@/features/withdrawal/withdrawal-assessment";
import { formatMoney, type Money } from "@/shared/money/money";
import { emailWithBreak } from "@/shared/utils/email-with-break";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
} from "./_components/workspace-email-content";
import { WithdrawalRefundBreakdown } from "./_components/withdrawal-refund-breakdown";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { contractWithdrawalReceiptPreviewProps } from "./_fixtures/preview-props";
import type { WorkspaceEmailDetail } from "./workspace-email-detail";

export type ContractWithdrawalReceiptEmailProps = {
  readonly locale: Locale;
  /** The reservation number the customer knows it by. */
  readonly reference: string;
  /** The customer's name, when their profile has one. */
  readonly customerName: string | null;
  /** Where this receipt goes: the email the statement named. */
  readonly receiptEmail: string;
  readonly contractLabel: string;
  readonly submittedAt: Temporal.Instant;
  readonly paidAmount: Money;
  readonly refundAmount: Money;
  readonly refundBasis: WithdrawalRefundBasis;
};

/** The subject, which the inbox also previews. */
export const contractWithdrawalReceiptEmailSubject = ({
  locale,
}: Pick<ContractWithdrawalReceiptEmailProps, "locale">) =>
  m.withdrawalReceiptEmailSubject({}, { locale });

/**
 * Confirms receipt of the customer's withdrawal statement in text form
 * (§1830a(5)): the statement's content, and the date and time it was sent.
 */
export function ContractWithdrawalReceiptEmail(
  props: ContractWithdrawalReceiptEmailProps
) {
  const { locale, refundBasis } = props;

  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={contractWithdrawalReceiptEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {m.withdrawalReceiptEmailHeading({}, { locale })}
      </WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.withdrawalReceiptEmailBody({}, { locale })}
      </WorkspaceEmailBody>
      <WorkspaceEmailDetails
        details={contractWithdrawalReceiptDetails(props)}
        wrapWords
      />
      {refundBasis.kind === "partial" && (
        <WithdrawalRefundBreakdown
          locale={locale}
          paidAmount={props.paidAmount}
          refundAmount={props.refundAmount}
          refundBasis={refundBasis}
          refundLabel={m.withdrawalReceiptRefundLabel({}, { locale })}
        />
      )}
    </WorkspaceEmailLayout>
  );
}

/**
 * The statement as submitted: the reservation, who sent it, where the
 * receipt goes, when it was sent, and (for a full refund) the refund.
 */
export const contractWithdrawalReceiptDetails = ({
  locale,
  reference,
  customerName,
  receiptEmail,
  contractLabel,
  submittedAt,
  refundAmount,
  refundBasis,
}: ContractWithdrawalReceiptEmailProps): readonly WorkspaceEmailDetail[] => [
  {
    label: m.withdrawalEmailReferenceLabel({}, { locale }),
    value: reference,
  },
  {
    label: m.withdrawalReceiptContractLabel({}, { locale }),
    value: contractLabel,
  },
  ...(customerName
    ? [
        {
          label: m.withdrawalEmailNameLabel({}, { locale }),
          value: customerName,
        },
      ]
    : []),
  {
    label: m.withdrawalEmailEmailLabel({}, { locale }),
    value: emailWithBreak(receiptEmail),
  },
  {
    label: m.withdrawalEmailSubmittedAtLabel({}, { locale }),
    value: m.withdrawalEmailPragueTime(
      { time: formatReservationDisplayDateTime(submittedAt, locale) },
      { locale }
    ),
  },
  ...(refundBasis.kind === "full"
    ? [
        {
          label: m.withdrawalReceiptRefundLabel({}, { locale }),
          value: formatMoney(refundAmount, locale),
        },
      ]
    : []),
];

ContractWithdrawalReceiptEmail.PreviewProps =
  contractWithdrawalReceiptPreviewProps;

export default ContractWithdrawalReceiptEmail;
