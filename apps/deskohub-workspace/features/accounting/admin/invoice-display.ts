import type { InvoiceArchiveError } from "@/features/accounting/invoice-archive";
import type { InvoiceCancellationError } from "@/features/accounting/invoice-cancellation";
import {
  type AdministrationCustomerName,
  isInactiveAdministrationCustomer,
} from "@/features/administration/customer-name";
import { getAdministrationCustomerName } from "@/features/administration/customer-presentation";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import type {
  InvoiceAdministrationCustomerErrorReason,
  InvoiceAdministrationListItem,
} from "./invoice-administration.service";

export const getInvoiceSourceLabel = (
  source: InvoiceAdministrationListItem["source"],
  locale: Locale
) =>
  ({
    "reservation-request": m.accountingInvoiceSourceReservationRequest,
    "post-order-link": m.accountingInvoiceSourcePostOrderLink,
    "admin-ui": m.accountingInvoiceSourceAdminUi,
    "dhw-cli": m.accountingInvoiceSourceDhwCli,
    assistant: m.accountingInvoiceSourceAssistant,
    legacy: m.accountingInvoiceSourceLegacy,
  })[source]({}, { locale });

/** The operator message for a rejected customer or billing detail. */
export const getInvoiceCustomerErrorMessage = (
  reason: InvoiceAdministrationCustomerErrorReason,
  locale: Locale
) =>
  ({
    "billing-details-invalid": m.accountingInvoiceBillingDetailsInvalid,
    "currency-not-payable": m.accountingInvoiceCurrencyNotPayable,
    "customer-deleted": m.accountingInvoiceCustomerInactive,
    "customer-email-ambiguous": m.accountingInvoiceCustomerEmailAmbiguous,
    "customer-id-invalid": m.accountingInvoiceCustomerIdInvalid,
    "customer-id-missing": m.accountingInvoiceCustomerIdMissing,
    "invoice-id-reused": m.accountingInvoiceIdReused,
  })[reason]({}, { locale });

/** The operator message for a refused or failed invoice cancellation. */
export const getInvoiceCancellationErrorMessage = (
  code: InvoiceCancellationError["code"],
  locale: Locale
) =>
  ({
    not_found: m.accountingInvoiceNotFound,
    reservation_confirmation_required:
      m.accountingInvoiceCancelErrorReservationConfirmationRequired,
    reservation_cancellation_in_progress:
      m.accountingInvoiceCancelErrorReservationCancellationInProgress,
    confirmation_stale: m.accountingInvoiceCancelErrorConfirmationStale,
    document_unavailable: m.accountingInvoiceCancelErrorDocumentUnavailable,
    persistence_failed: m.accountingInvoiceCancelErrorPersistenceFailed,
  })[code]({}, { locale });

/** The operator message for a refused hide. */
export const getInvoiceArchiveErrorMessage = (
  code: InvoiceArchiveError["code"],
  locale: Locale
) =>
  ({
    not_found: m.accountingInvoiceNotFound,
    not_cancelled: m.accountingInvoiceHideErrorNotCancelled,
  })[code]({}, { locale });

/** Names a customer in the operator's language: the deleted or expired placeholder, the name, or "Unnamed customer". */
export const getInvoiceCustomerName = (
  customer: AdministrationCustomerName,
  locale: Locale
) => {
  if (isInactiveAdministrationCustomer(customer))
    return getAdministrationCustomerName(customer, locale);
  return customer.hasName
    ? customer.displayName
    : m.accountingUnnamedCustomer({}, { locale });
};
