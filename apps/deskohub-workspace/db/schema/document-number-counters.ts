import { sql } from "drizzle-orm";
import { check, integer, pgTable } from "drizzle-orm/pg-core";

/**
 * An annual numbering counter: one row per Prague numbering year holding the
 * last sequence issued. Each document series has its own table, so the
 * running deployment's upsert on `numbering_year` keeps its conflict target.
 */
const annualNumberCounterTable = <Name extends string>(name: Name) =>
  pgTable(
    name,
    {
      numberingYear: integer("numbering_year").primaryKey(),
      lastSequence: integer("last_sequence").notNull(),
    },
    (t) => [check(`${name}_sequence_check`, sql`${t.lastSequence} > 0`)]
  );

/** Any annual numbering counter table. */
export type AnnualNumberCounter = ReturnType<
  typeof annualNumberCounterTable<string>
>;

export const invoiceNumberCounters = annualNumberCounterTable(
  "invoice_number_counters"
);

export const correctiveDocumentNumberCounters = annualNumberCounterTable(
  "corrective_document_number_counters"
);
