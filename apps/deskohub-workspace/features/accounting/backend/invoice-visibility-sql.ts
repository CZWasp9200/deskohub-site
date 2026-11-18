import { type SQL, sql } from "drizzle-orm";

/**
 * The SQL twin of `customerInvoiceVisibility`: whether an `invoices` row is
 * listed to its customer. A customer keeps every issued invoice, cancelled or
 * archived, so it is always true; keep it equal to the TypeScript rule.
 */
export const isVisibleToCustomer = (): SQL => sql`true`;
