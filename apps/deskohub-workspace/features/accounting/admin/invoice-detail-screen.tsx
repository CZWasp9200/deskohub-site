import { Suspense } from "react";
import {
  formatInvoiceTotal,
  InvoiceSettlement,
} from "@/features/accounting/invoice-settlement";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  administrationHref,
  localizeAdministrationHref,
} from "@/features/administration/administration-href";
import {
  AdministrationDetailSection,
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import {
  formatAdministrationDateTime,
  formatAdministrationPlainDate,
} from "@/features/administration/formatters";
import { m } from "@/features/administration/i18n";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import type {
  InvoiceAdministrationCancellation,
  InvoiceAdministrationDetail,
} from "./invoice-administration.service";
import {
  InvoiceCancellationActions,
  InvoiceDeliverySummary,
  InvoiceDetailActions,
  InvoiceStatusBadges,
} from "./invoice-detail";
import { getInvoiceSourceLabel } from "./invoice-display";
import {
  type InvoiceAdministrationChainLink,
  loadInvoiceAdministrationChainLinks,
  loadInvoiceAdministrationDetail,
} from "./page-data.server";

export async function InvoiceAdministrationDetailScreen({
  params,
}: {
  readonly params: Promise<{ readonly invoiceId: string }>;
}) {
  const locale = await getRequestLocale();
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <InvoiceDetailContent locale={locale} params={params} />
    </Suspense>
  );
}

async function InvoiceDetailContent({
  locale,
  params,
}: {
  readonly locale: Locale;
  readonly params: Promise<{ readonly invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const invoice = await loadInvoiceAdministrationDetail(invoiceId);
  const chain = await loadInvoiceAdministrationChainLinks(invoice);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={<InvoiceDetailActions invoice={invoice} />}
        description={m.accountingInvoiceDetailDescription(
          {
            customerName: invoice.customerName,
            total: formatInvoiceTotal(
              { amount: invoice.total, currency: invoice.currency },
              locale
            ),
          },
          { locale }
        )}
        eyebrow={m.accountingInvoiceDetailEyebrow({}, { locale })}
        title={invoice.invoiceNumber}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="overflow-hidden rounded-2xl border border-navy-blue/10 bg-white">
          <iframe
            className="h-[75vh] min-h-[40rem] w-full"
            src={localizeAdministrationHref(invoice.pdfUrl, locale)}
            title={m.accountingInvoiceDetailPdfTitle(
              { invoiceNumber: invoice.invoiceNumber },
              { locale }
            )}
          />
        </section>
        <div className="space-y-6">
          {invoice.cancellation && (
            <InvoiceCancellationSection
              cancellation={invoice.cancellation}
              invoice={invoice}
              locale={locale}
            />
          )}
          <AdministrationDetailSection
            title={m.accountingInvoiceDetailPaymentSection({}, { locale })}
          >
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-navy-blue/60">
                  {m.accountingInvoiceDetailStatus({}, { locale })}
                </dt>
                <dd className="mt-1">
                  <InvoiceStatusBadges invoice={invoice} />
                </dd>
              </div>
              {InvoiceSettlement.$is("PaymentRequested")(
                invoice.settlement
              ) && (
                <div>
                  <dt className="text-navy-blue/60">
                    {m.accountingInvoiceDetailDueDate({}, { locale })}
                  </dt>
                  <dd className="font-semibold">
                    {formatAdministrationPlainDate(
                      invoice.settlement.dueDate,
                      locale
                    )}
                  </dd>
                </div>
              )}
              {invoice.paidOn && (
                <div>
                  <dt className="text-navy-blue/60">
                    {m.accountingInvoiceDetailPaidOn({}, { locale })}
                  </dt>
                  <dd className="font-semibold">
                    {formatAdministrationPlainDate(invoice.paidOn, locale)}
                  </dd>
                </div>
              )}
            </dl>
          </AdministrationDetailSection>
          <AdministrationDetailSection
            title={m.accountingInvoiceDetailDeliverySection({}, { locale })}
          >
            <InvoiceDeliverySummary delivery={invoice.delivery} />
          </AdministrationDetailSection>
          <AdministrationDetailSection
            title={m.accountingInvoiceDetailProvenanceSection({}, { locale })}
          >
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-navy-blue/60">
                  {m.accountingInvoiceDetailSource({}, { locale })}
                </dt>
                <dd className="font-semibold">
                  {getInvoiceSourceLabel(invoice.source, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-navy-blue/60">
                  {m.accountingInvoiceDetailActor({}, { locale })}
                </dt>
                <dd className="font-semibold">
                  {invoice.actor ??
                    m.accountingInvoiceSourceLegacy({}, { locale })}
                </dd>
              </div>
              <div>
                <dt className="text-navy-blue/60">
                  {m.accountingInvoiceDetailIssued({}, { locale })}
                </dt>
                <dd className="font-semibold">
                  {formatAdministrationDateTime(invoice.issuedAt, locale)}
                </dd>
              </div>
              {chain.replaces && (
                <InvoiceChainFact
                  label={m.accountingInvoiceDetailReplaces({}, { locale })}
                  link={chain.replaces}
                />
              )}
              {chain.replacedBy && (
                <InvoiceChainFact
                  label={m.accountingInvoiceDetailReplacedBy({}, { locale })}
                  link={chain.replacedBy}
                />
              )}
            </dl>
          </AdministrationDetailSection>
        </div>
      </div>
    </AdministrationPage>
  );
}

/** Links a related invoice the Admin UI still shows. */
function InvoiceChainFact({
  label,
  link,
}: {
  readonly label: string;
  readonly link: InvoiceAdministrationChainLink;
}) {
  return (
    <div>
      <dt className="text-navy-blue/60">{label}</dt>
      <dd className="font-semibold">
        <Link
          className="underline underline-offset-4"
          href={administrationHref("/[locale]/admin/invoices/[invoiceId]", {
            invoiceId: link.id,
          })}
        >
          {link.invoiceNumber}
        </Link>
      </dd>
    </div>
  );
}

/**
 * A cancelled invoice's cancellation: when, by whom, through which channel
 * and why, its credit note, the notices, and hiding the invoice.
 */
function InvoiceCancellationSection({
  cancellation,
  invoice,
  locale,
}: {
  readonly cancellation: InvoiceAdministrationCancellation;
  readonly invoice: InvoiceAdministrationDetail;
  readonly locale: Locale;
}) {
  const facts = [
    {
      label: m.accountingInvoiceCancellationCancelledAt({}, { locale }),
      value: formatAdministrationDateTime(cancellation.cancelledAt, locale),
    },
    {
      label: m.accountingInvoiceCancellationActor({}, { locale }),
      value: cancellation.actor,
    },
    {
      label: m.accountingInvoiceCancellationChannel({}, { locale }),
      value: getInvoiceSourceLabel(cancellation.source, locale),
    },
    {
      label: m.accountingInvoiceCancellationCause({}, { locale }),
      value: {
        invoice_cancellation: m.accountingInvoiceCancellationCauseInvoice,
        reservation_cancellation:
          m.accountingInvoiceCancellationCauseReservation,
      }[cancellation.cause]({}, { locale }),
    },
  ];
  return (
    <AdministrationDetailSection
      title={m.accountingInvoiceCancellationSection({}, { locale })}
    >
      <div className="space-y-4">
        <dl className="space-y-3 text-sm">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-navy-blue/60">{fact.label}</dt>
              <dd className="font-semibold">{fact.value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-navy-blue/60">
              {m.accountingInvoiceCancellationCreditNote({}, { locale })}
            </dt>
            <dd className="font-semibold">
              <a
                className="underline underline-offset-4"
                download
                href={localizeAdministrationHref(
                  cancellation.correctiveDocumentPdfUrl,
                  locale
                )}
              >
                {cancellation.correctiveDocumentNumber}
              </a>
            </dd>
          </div>
        </dl>
        <InvoiceCancellationActions
          invoice={{
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            cancellation,
          }}
        />
      </div>
    </AdministrationDetailSection>
  );
}
