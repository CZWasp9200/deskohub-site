import { m } from "@/features/i18n";
import { formatReservationDisplayDateTime } from "@/features/reservation/reservation-date";
import { staffLocale } from "@/shared/backend/staff-locale";
import { formatMoney, type Money } from "@/shared/money/money";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
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
  readonly submittedAt: Temporal.Instant;
  readonly paidAmount: Money;
  readonly refundAmount: Money;
};

/** The subject before the staff marker, in the staff locale. */
export const contractWithdrawalNoticeEmailSubject = ({
  contractLabel,
}: Pick<ContractWithdrawalNoticeEmailProps, "contractLabel">) =>
  m.withdrawalNoticeEmailSubject(
    { contract: contractLabel },
    { locale: staffLocale }
  );

/** Tells staff a customer withdrew online and what refund is owed. */
export function ContractWithdrawalNoticeEmail(
  props: ContractWithdrawalNoticeEmailProps
) {
  const details: readonly WorkspaceEmailDetail[] = [
    {
      label: m.withdrawalEmailContractLabel({}, { locale: staffLocale }),
      value: `${props.contractLabel} (${props.contractId})`,
    },
    {
      label: m.withdrawalEmailAccountLabel({}, { locale: staffLocale }),
      value: props.accountId,
    },
    {
      label: m.withdrawalEmailSubmittedAtLabel({}, { locale: staffLocale }),
      value: formatReservationDisplayDateTime(props.submittedAt, staffLocale),
    },
    {
      label: m.withdrawalEmailRefundLabel({}, { locale: staffLocale }),
      value: `${formatMoney(props.refundAmount, staffLocale)} / ${formatMoney(props.paidAmount, staffLocale)}`,
    },
  ];

  return (
    <WorkspaceEmailLayout
      locale={staffLocale}
      preview={contractWithdrawalNoticeEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {contractWithdrawalNoticeEmailSubject(props)}
      </WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.withdrawalNoticeEmailBody({}, { locale: staffLocale })}
      </WorkspaceEmailBody>
      <WorkspaceEmailDetails details={details} />
    </WorkspaceEmailLayout>
  );
}

ContractWithdrawalNoticeEmail.PreviewProps =
  contractWithdrawalNoticePreviewProps;

export default ContractWithdrawalNoticeEmail;
