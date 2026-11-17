import { type Locale, m } from "@/features/i18n";
import { formatReservationDisplayDateTime } from "@/features/reservation/reservation-date";
import { formatMoney, type Money } from "@/shared/money/money";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { contractWithdrawalReceiptPreviewProps } from "./_fixtures/preview-props";
import type { WorkspaceEmailDetail } from "./workspace-email-detail";

export type ContractWithdrawalReceiptEmailProps = {
  readonly locale: Locale;
  /** The customer's name, when their profile has one. */
  readonly customerName: string | null;
  readonly contractLabel: string;
  readonly submittedAt: Temporal.Instant;
  readonly refundAmount: Money;
};

/** The subject, which the inbox also previews. */
export const contractWithdrawalReceiptEmailSubject = ({
  locale,
}: Pick<ContractWithdrawalReceiptEmailProps, "locale">) =>
  m.withdrawalReceiptEmailSubject({}, { locale });

/**
 * Confirms receipt of the customer's withdrawal statement in text form: its
 * content, the contract, and the date and time it was submitted.
 */
export function ContractWithdrawalReceiptEmail(
  props: ContractWithdrawalReceiptEmailProps
) {
  const { locale } = props;

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
      />
      <WorkspaceEmailBody>
        {m.withdrawalReceiptEmailRefundNote({}, { locale })}
      </WorkspaceEmailBody>
    </WorkspaceEmailLayout>
  );
}

/** The statement as submitted, with its contract, time and refund. */
export const contractWithdrawalReceiptDetails = ({
  locale,
  customerName,
  contractLabel,
  submittedAt,
  refundAmount,
}: ContractWithdrawalReceiptEmailProps): readonly WorkspaceEmailDetail[] => [
  {
    label: m.withdrawalEmailStatementLabel({}, { locale }),
    value: m.withdrawalStatementText({ contract: contractLabel }, { locale }),
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
    label: m.withdrawalEmailContractLabel({}, { locale }),
    value: contractLabel,
  },
  {
    label: m.withdrawalEmailSubmittedAtLabel({}, { locale }),
    value: formatReservationDisplayDateTime(submittedAt, locale),
  },
  {
    label: m.withdrawalEmailRefundLabel({}, { locale }),
    value: formatMoney(refundAmount, locale),
  },
];

ContractWithdrawalReceiptEmail.PreviewProps =
  contractWithdrawalReceiptPreviewProps;

export default ContractWithdrawalReceiptEmail;
