import { Data } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { InvoiceId } from "@/features/accounting/manual-invoice";
import type { AdministrationSource } from "@/features/administrators/administration-source";

/**
 * An administrator hid a cancelled invoice from the administration UI. The
 * Admin API, dhw and agent tools still read it; the customer is unaffected.
 */
export interface InvoiceArchive {
  readonly invoiceId: InvoiceId;
  readonly archivedAt: Temporal.Instant;
  readonly source: AdministrationSource;
  readonly actor: {
    /** `null` once the administrator's account is deleted. */
    readonly accountId: CustomerAccountId | null;
    /** The administrator's login email when they archived the invoice. */
    readonly email: string;
  };
}

export class InvoiceArchiveError extends Data.TaggedError(
  "InvoiceArchiveError"
)<{
  /** `not_cancelled`: only a cancelled invoice can be archived. */
  readonly code: "not_found" | "not_cancelled";
  readonly invoiceId: InvoiceId;
  readonly message: string;
}> {}
