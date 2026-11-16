import "@/shared/polyfills/temporal";

import { sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import type { AnnualNumberCounter } from "@/db/schema";
import { getInvoiceNumberingYear } from "@/features/accounting/invoice";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";

class DocumentNumberAllocationError extends Data.TaggedError(
  "DocumentNumberAllocationError"
)<{ readonly message: string }> {}

/** A number taken from an annual series, and the instant it was issued at. */
interface AnnualNumberAllocation {
  readonly issuedAt: Temporal.Instant;
  readonly numberingYear: number;
  readonly numberingSequence: number;
}

/**
 * Takes the next number of the issue year's counter in the series, in Prague
 * time. It writes with the caller's transaction, so a rollback returns the
 * number: concurrent issuers wait on the counter row and no number is skipped.
 */
export const allocateAnnualNumber = Effect.fn("allocateAnnualNumber")(
  function* (counter: AnnualNumberCounter) {
    const { db } = yield* WorkspaceTransaction;
    // Stored instants keep millisecond precision.
    const issuedAt = Temporal.Instant.from(
      temporalInstantToIsoString(Temporal.Now.instant())
    );
    const numberingYear = getInvoiceNumberingYear(issuedAt);
    const [allocated] = yield* db
      .insert(counter)
      .values({ numberingYear, lastSequence: 1 })
      .onConflictDoUpdate({
        target: counter.numberingYear,
        set: { lastSequence: sql`${counter.lastSequence} + 1` },
      })
      .returning({ sequence: counter.lastSequence });

    if (!allocated) {
      return yield* new DocumentNumberAllocationError({
        message: "Document number allocation returned no row.",
      });
    }

    return {
      issuedAt,
      numberingYear,
      numberingSequence: allocated.sequence,
    } satisfies AnnualNumberAllocation;
  }
);
