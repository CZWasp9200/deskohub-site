import { m } from "@/features/i18n";
import { formatReservationDisplayDateTime } from "@/features/reservation/reservation-date";
import { staffLocale } from "@/shared/backend/staff-locale";
import { formatMoney, type Money } from "@/shared/money/money";
import { contractWithdrawalNoticePreviewProps } from "./_fixtures/preview-props";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
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
  const locale = staffLocale;
  const details: readonly WorkspaceEmailDetail[] = [
    {
      label: m.withdrawalEmailContractLabel({}, { locale }),
      value: `${props.contractLabel} (${props.contractId})`,
    },
    {
      label: m.withdrawalEmailAccountLabel({}, { locale }),
      value: props.accountId,
    },
    {
      label: m.withdrawalEmailSubmittedAtLabel({}, { locale }),
      value: formatReservationDisplayDateTime(props.submittedAt, locale),
    },
    {
      label: m.withdrawalEmailRefundLabel({}, { locale }),
      value: `${formatMoney(props.refundAmount, locale)} / ${formatMoney(props.paidAmount, locale)}`,
    },
  ];

  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={contractWithdrawalNoticeEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {contractWithdrawalNoticeEmailSubject(props)}
      </WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.withdrawalNoticeEmailBody({}, { locale })}
      </WorkspaceEmailBody>
      <WorkspaceEmailDetails details={details} />
    </WorkspaceEmailLayout>
  );
}

ContractWithdrawalNoticeEmail.PreviewProps =
  contractWithdrawalNoticePreviewProps;

export default ContractWithdrawalNoticeEmail;
