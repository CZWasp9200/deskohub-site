import "@/shared/polyfills/temporal";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { EmailDeliveryId } from "@deskohub/email";
import { and, asc, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  invoiceCancellations,
  invoiceEmailDeliveries,
  invoiceEmailDeliveryAudiences,
  invoices,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { InvoiceNumber } from "@/features/accounting/invoice";
import type {
  InvoiceDeliveryStatus,
  InvoiceDeliverySummary,
  InvoiceEmailDeliveryAudience,
  InvoiceEmailDeliveryFailureCode,
  InvoiceEmailDeliveryState,
} from "@/features/accounting/invoice-email-delivery";
import {
  type InvoiceId,
  invoiceIdSchema,
} from "@/features/accounting/manual-invoice";
import {
  type ReadLimitExceededError,
  readLimitSentinel,
  requireWithinReadLimit,
} from "@/shared/backend/read-limit";
import { isStaleDeliveryClaim } from "./delivery-claim-lease";

interface InvoiceEmailDeliveryClaim {
  readonly attemptNumber: number;
}

/**
 * The state of one invoice email sent to the customer. The operator's
 * internal copy, the attempt count, the failure code and the provider's
 * delivery id are not part of it.
 */
export interface CustomerInvoiceDelivery {
  readonly invoiceNumber: InvoiceNumber;
  readonly state: InvoiceEmailDeliveryState;
  readonly createdAt: Temporal.Instant;
  readonly acceptedAt: Temporal.Instant | null;
}

export interface IInvoiceEmailDeliveryRepository {
  /**
   * Claims the audience's original invoice email: a first claim, or another
   * attempt after a failure or an expired lease. `null` when it was accepted
   * or another worker holds it; `cancelled` when the invoice is cancelled.
   * Admission waits for a cancellation of the invoice in progress.
   */
  readonly claim: (input: {
    readonly invoiceId: string;
    readonly audience: InvoiceEmailDeliveryAudience;
  }) => Effect.Effect<
    InvoiceEmailDeliveryClaim | "cancelled" | null,
    DatabaseQueryError
  >;
  /** Claims an explicit customer resend, admitted like `claim`. */
  readonly claimResend: (input: {
    readonly invoiceId: string;
  }) => Effect.Effect<
    InvoiceEmailDeliveryClaim | "cancelled" | null,
    DatabaseQueryError
  >;
  /**
   * Records the claimed attempt as accepted. An attempt another claim has
   * superseded still records that the email was accepted (`sentTo`).
   */
  readonly markAccepted: (input: {
    readonly invoiceId: string;
    readonly audience: InvoiceEmailDeliveryAudience;
    readonly attemptNumber: number;
    readonly providerDeliveryId: EmailDeliveryId;
    readonly acceptedAt: Temporal.Instant;
  }) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly markFailed: (input: {
    readonly invoiceId: string;
    readonly audience: InvoiceEmailDeliveryAudience;
    readonly attemptNumber: number;
    readonly failureCode: InvoiceEmailDeliveryFailureCode;
  }) => Effect.Effect<void, EffectDrizzleQueryError>;
  /**
   * The customer-audience deliveries of the Dotypos customer's invoices,
   * oldest first, scoped by the invoice's own customer column. Fails with
   * `ReadLimitExceededError`, returning no rows, when there are more than
   * `limit`.
   */
  readonly listForCustomer: (input: {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly limit: number;
  }) => Effect.Effect<
    readonly CustomerInvoiceDelivery[],
    EffectDrizzleQueryError | ReadLimitExceededError
  >;
  /** Summarizes every requested invoice, including one with no delivery yet. */
  readonly status: (
    invoiceIds: readonly InvoiceId[]
  ) => Effect.Effect<
    ReadonlyMap<InvoiceId, InvoiceDeliverySummary>,
    EffectDrizzleQueryError
  >;
}

export class InvoiceEmailDeliveryRepository extends Context.Service<
  InvoiceEmailDeliveryRepository,
  IInvoiceEmailDeliveryRepository
>()("@deskohub-workspace/accounting/InvoiceEmailDeliveryRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db, transaction } = yield* WorkspaceDatabase;

      const claimOriginal = Effect.fnUntraced(function* ({
        audience,
        invoiceId,
      }: {
        readonly invoiceId: string;
        readonly audience: InvoiceEmailDeliveryAudience;
      }) {
        const now = Temporal.Now.instant();
        const [claimed] = yield* db
          .insert(invoiceEmailDeliveries)
          .values({
            invoiceId,
            audience,
            state: "processing",
            attemptCount: 1,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              invoiceEmailDeliveries.invoiceId,
              invoiceEmailDeliveries.audience,
            ],
            set: {
              state: "processing",
              attemptCount: sql`${invoiceEmailDeliveries.attemptCount} + 1`,
              providerDeliveryId: null,
              failureCode: null,
              // An earlier acceptance stays recorded: the invoice was sent.
              updatedAt: now,
            },
            setWhere: or(
              eq(invoiceEmailDeliveries.state, "failed"),
              isStaleProcessing()
            ),
          })
          .returning({
            attemptNumber: invoiceEmailDeliveries.attemptCount,
          });

        return claimed ?? null;
      });

      const claimCustomerResend = Effect.fnUntraced(function* (
        invoiceId: string
      ) {
        const now = Temporal.Now.instant();
        const [claimed] = yield* db
          .insert(invoiceEmailDeliveries)
          .values({
            invoiceId,
            audience: "customer",
            state: "processing",
            attemptCount: 1,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              invoiceEmailDeliveries.invoiceId,
              invoiceEmailDeliveries.audience,
            ],
            set: {
              state: "processing",
              attemptCount: sql`case when ${invoiceEmailDeliveries.state} = 'processing' then ${invoiceEmailDeliveries.attemptCount} else ${invoiceEmailDeliveries.attemptCount} + 1 end`,
              failureCode: null,
              updatedAt: now,
            },
            setWhere: or(
              eq(invoiceEmailDeliveries.state, "accepted"),
              eq(invoiceEmailDeliveries.state, "failed"),
              isStaleProcessing()
            ),
          })
          .returning({
            attemptNumber: invoiceEmailDeliveries.attemptCount,
          });

        return claimed ?? null;
      });

      /**
       * Admits a claim only while the invoice is not cancelled. The share lock
       * waits for a cancellation that holds the invoice row, so a claim either
       * lands before it (and the cancellation sees the email in flight) or
       * sees it.
       */
      const admitUncancelled = <A, E>(
        invoiceId: string,
        claim: Effect.Effect<A, E>
      ) =>
        transaction(
          Effect.gen(function* () {
            const [invoice] = yield* db
              .select({ id: invoices.id })
              .from(invoices)
              .where(eq(invoices.id, invoiceId))
              .limit(1)
              .for("share");
            // An unknown invoice fails the claim's foreign key.
            if (!invoice) return yield* claim;
            const [cancellation] = yield* db
              .select({ invoiceId: invoiceCancellations.invoiceId })
              .from(invoiceCancellations)
              .where(
                eq(
                  invoiceCancellations.invoiceId,
                  invoiceIdSchema.make(invoiceId)
                )
              )
              .limit(1);
            if (cancellation) return "cancelled" as const;
            return yield* claim;
          })
        );

      return {
        claim: Effect.fn("InvoiceEmailDeliveryRepository.claim")(function* ({
          audience,
          invoiceId,
        }) {
          return yield* admitUncancelled(
            invoiceId,
            claimOriginal({ audience, invoiceId })
          );
        }),
        claimResend: Effect.fn("InvoiceEmailDeliveryRepository.claimResend")(
          function* ({ invoiceId }) {
            return yield* admitUncancelled(
              invoiceId,
              claimCustomerResend(invoiceId)
            );
          }
        ),
        markAccepted: Effect.fn("InvoiceEmailDeliveryRepository.markAccepted")(
          function* (input) {
            const [recorded] = yield* db
              .update(invoiceEmailDeliveries)
              .set({
                state: "accepted",
                providerDeliveryId: input.providerDeliveryId,
                failureCode: null,
                acceptedAt: input.acceptedAt,
                updatedAt: input.acceptedAt,
              })
              .where(
                and(
                  eq(invoiceEmailDeliveries.invoiceId, input.invoiceId),
                  eq(invoiceEmailDeliveries.audience, input.audience),
                  eq(invoiceEmailDeliveries.state, "processing"),
                  eq(invoiceEmailDeliveries.attemptCount, input.attemptNumber)
                )
              )
              .returning({ id: invoiceEmailDeliveries.id });
            if (recorded) return;
            // Another claim superseded the attempt; the email still went out.
            yield* db
              .update(invoiceEmailDeliveries)
              .set({ acceptedAt: input.acceptedAt })
              .where(
                and(
                  eq(invoiceEmailDeliveries.invoiceId, input.invoiceId),
                  eq(invoiceEmailDeliveries.audience, input.audience),
                  isNull(invoiceEmailDeliveries.acceptedAt)
                )
              );
          }
        ),
        markFailed: Effect.fn("InvoiceEmailDeliveryRepository.markFailed")(
          function* (input) {
            yield* db
              .update(invoiceEmailDeliveries)
              .set({
                state: "failed",
                failureCode: input.failureCode,
                updatedAt: Temporal.Now.instant(),
              })
              .where(
                and(
                  eq(invoiceEmailDeliveries.invoiceId, input.invoiceId),
                  eq(invoiceEmailDeliveries.audience, input.audience),
                  eq(invoiceEmailDeliveries.state, "processing"),
                  eq(invoiceEmailDeliveries.attemptCount, input.attemptNumber)
                )
              );
          }
        ),
        listForCustomer: Effect.fn(
          "InvoiceEmailDeliveryRepository.listForCustomer"
        )(function* ({ dotyposCustomerId, limit }) {
          const rows: readonly CustomerInvoiceDelivery[] = yield* db
            .select({
              invoiceNumber: invoices.invoiceNumber,
              state: invoiceEmailDeliveries.state,
              createdAt: invoiceEmailDeliveries.createdAt,
              acceptedAt: invoiceEmailDeliveries.acceptedAt,
            })
            .from(invoiceEmailDeliveries)
            .innerJoin(
              invoices,
              eq(invoiceEmailDeliveries.invoiceId, invoices.id)
            )
            .where(
              and(
                eq(invoices.dotyposCustomerId, dotyposCustomerId),
                eq(invoiceEmailDeliveries.audience, "customer")
              )
            )
            .orderBy(
              asc(invoiceEmailDeliveries.createdAt),
              asc(invoiceEmailDeliveries.id)
            )
            .limit(readLimitSentinel(limit));
          return yield* requireWithinReadLimit(rows, limit);
        }),
        status: Effect.fn("InvoiceEmailDeliveryRepository.status")(
          function* (invoiceIds) {
            const rows =
              invoiceIds.length === 0
                ? []
                : yield* db
                    .select({
                      invoiceId: invoiceEmailDeliveries.invoiceId,
                      audience: invoiceEmailDeliveries.audience,
                      state: invoiceEmailDeliveries.state,
                      acceptedAt: invoiceEmailDeliveries.acceptedAt,
                      stale: sql<boolean>`${isStaleProcessing()}`,
                    })
                    .from(invoiceEmailDeliveries)
                    .where(
                      inArray(invoiceEmailDeliveries.invoiceId, invoiceIds)
                    );
            const deliveriesByInvoice = Map.groupBy(
              rows,
              ({ invoiceId }) => invoiceId
            );
            return new Map(
              invoiceIds.map((invoiceId) => {
                const deliveries = deliveriesByInvoice.get(invoiceId) ?? [];
                const statusOf = (
                  audience: InvoiceEmailDeliveryAudience
                ): InvoiceDeliveryStatus =>
                  deliveries.find((delivery) => delivery.audience === audience)
                    ?.state ?? "missing";
                const customer = statusOf("customer");
                const internal = statusOf("internal");
                const summary: InvoiceDeliverySummary = {
                  customer,
                  internal,
                  needsAttention:
                    deliveries.some(({ stale }) => stale) ||
                    [customer, internal].some(
                      (status) => status === "missing" || status === "failed"
                    ),
                  sentTo: invoiceEmailDeliveryAudiences.filter((audience) =>
                    deliveries.some(
                      (delivery) =>
                        delivery.audience === audience &&
                        delivery.acceptedAt !== null
                    )
                  ),
                };
                return [invoiceId, summary] as const;
              })
            );
          }
        ),
      } satisfies IInvoiceEmailDeliveryRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

/** Matches a processing invoice delivery whose claim outlived its lease. */
const isStaleProcessing = (): SQL =>
  isStaleDeliveryClaim(invoiceEmailDeliveries);
