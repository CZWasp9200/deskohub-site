import { Match } from "effect";
import type { CorrectiveDocument } from "@/features/accounting/corrective-document";
import { getCorrectiveDocumentSettlementSentence } from "@/features/accounting/corrective-document-presentation";
import { type Locale, m } from "@/features/i18n";
import { staffLocale } from "@/shared/backend/staff-locale";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
} from "./_components/workspace-email-content";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { invoiceCancellationNoticePreviewProps } from "./_fixtures/preview-props";

export type InvoiceCancellationNoticeEmailProps = {
  readonly invoiceNumber: string;
  /** The attached corrective document's number. */
  readonly documentNumber: string;
  readonly invoice:
    | { readonly source: "reservation"; readonly orderId: string }
    | { readonly source: "manual" };
  /** What the corrective document means for the customer's money. */
  readonly settlement: Pick<
    CorrectiveDocument,
    "currency" | "settlement" | "total"
  >;
  /** Customers read it in the document's locale, staff in the staff locale. */
  readonly recipient:
    | { readonly audience: "customer"; readonly locale: Locale }
    | { readonly audience: "internal" };
};

const recipientLocale = ({
  recipient,
}: InvoiceCancellationNoticeEmailProps): Locale =>
  recipient.audience === "customer" ? recipient.locale : staffLocale;

/** The cancelled invoice's number; the subject and inbox preview. */
export const invoiceCancellationNoticeEmailTitle = (
  props: InvoiceCancellationNoticeEmailProps
) =>
  m.invoiceCancellationNoticeTitle(
    { invoiceNumber: props.invoiceNumber },
    { locale: recipientLocale(props) }
  );

const invoiceCancellationNoticeCopy = (
  props: InvoiceCancellationNoticeEmailProps
) => {
  const { invoice, invoiceNumber, documentNumber } = props;
  const locale = recipientLocale(props);

  return Match.value(props.recipient.audience).pipe(
    Match.when("customer", () => ({
      heading: m.invoiceCancellationNoticeHeading({}, { locale }),
      body: Match.value(invoice).pipe(
        Match.when({ source: "reservation" }, ({ orderId }) =>
          m.invoiceCancellationNoticeBody(
            { invoiceNumber, orderId, documentNumber },
            { locale }
          )
        ),
        Match.when({ source: "manual" }, () =>
          m.invoiceCancellationNoticeManualBody(
            { invoiceNumber, documentNumber },
            { locale }
          )
        ),
        Match.exhaustive
      ),
      settlement: getCorrectiveDocumentSettlementSentence({
        ...props.settlement,
        locale,
      }),
    })),
    Match.when("internal", () => ({
      heading: m.invoiceCancellationNoticeInternalHeading({}, { locale }),
      body: Match.value(invoice).pipe(
        Match.when({ source: "reservation" }, ({ orderId }) =>
          m.invoiceCancellationNoticeInternalBody(
            { invoiceNumber, orderId, documentNumber },
            { locale }
          )
        ),
        Match.when({ source: "manual" }, () =>
          m.invoiceCancellationNoticeManualInternalBody(
            { invoiceNumber, documentNumber },
            { locale }
          )
        ),
        Match.exhaustive
      ),
      settlement: null,
    })),
    Match.exhaustive
  );
};

/**
 * Tells a recipient of an issued invoice that it was cancelled; the attached
 * corrective document cancels it in full. It never asks for payment.
 */
export function InvoiceCancellationNoticeEmail(
  props: InvoiceCancellationNoticeEmailProps
) {
  const { heading, body, settlement } = invoiceCancellationNoticeCopy(props);

  return (
    <WorkspaceEmailLayout
      locale={recipientLocale(props)}
      preview={invoiceCancellationNoticeEmailTitle(props)}
    >
      <WorkspaceEmailHeading>{heading}</WorkspaceEmailHeading>
      <WorkspaceEmailBody>{body}</WorkspaceEmailBody>
      {settlement ? (
        <WorkspaceEmailBody>{settlement}</WorkspaceEmailBody>
      ) : null}
    </WorkspaceEmailLayout>
  );
}

InvoiceCancellationNoticeEmail.PreviewProps =
  invoiceCancellationNoticePreviewProps;

export default InvoiceCancellationNoticeEmail;
