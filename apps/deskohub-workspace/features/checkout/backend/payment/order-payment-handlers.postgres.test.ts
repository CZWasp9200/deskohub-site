import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import {
  NexiOperationIdSchema,
  NexiService,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import { and, eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { orders, paymentAttempts } from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { OrderId } from "@/features/order";
import { findOrderKind } from "@/features/order/backend/order-kind";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { CheckoutAnalytics } from "../analytics/checkout-analytics.service";
import {
  PaymentAttemptRepository,
  toPaymentAttempt,
} from "../repositories/payment-attempt.repository";
import {
  insertPaymentAttempt,
  markPaymentAttemptPaid,
  markPaymentAttemptTerminal,
} from "../repositories/payment-attempt-writes";
import { WebhookEventRepository } from "../repositories/webhook-event.repository";
import { LatePaymentVerificationService } from "./late-payment-verification.service";
import { startNexiPaymentSession } from "./nexi-payment-session";
import { NexiWebhookService } from "./nexi-webhook.service";
import type { AdmittingOrderPaymentHandler } from "./order-payment-handler";
import { OrderPaymentHandlers } from "./order-payment-handlers.service";
import { PaymentRefundService } from "./payment-refund.service";
import { ProviderPaymentFinalizationService } from "./provider-payment-finalization.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const accountingDetails = Schema.Struct({ description: Schema.NonEmptyString });

describe.skipIf(!testDatabase)("Order payments without a reservation", () => {
  if (!testDatabase) return;
  const orderIds: OrderId[] = [];

  afterAll(async () => {
    await testDatabase.pool.query(
      "delete from webhook_events where payment_attempt_id in (select id from payment_attempts where order_id = any($1))",
      [orderIds]
    );
    await testDatabase.pool.query("delete from orders where id = any($1)", [
      orderIds,
    ]);
  });

  const fixture = Effect.gen(function* () {
    const { db, transaction } = yield* WorkspaceDatabase;
    const [order] = yield* db
      .insert(orders)
      .values({
        kind: "pass-purchase",
        dotyposCustomerId: DotyposCustomerIdSchema.make(
          "synthetic-order-buyer"
        ),
        paymentState: "not_started",
        fulfillmentState: "not_started",
      })
      .returning();
    if (!order) throw new Error("Could not create the synthetic order");
    orderIds.push(order.id);

    // The synthetic kind owns its own accounting data and recovery markers.
    // A real kind persists these in its domain storage.
    const snapshots = new Map<
      PaymentAttemptId,
      Readonly<{ description: string }>
    >();
    const recoveries = new Set<PaymentAttemptId>();
    const fulfilled = new Set<OrderId>();
    const reportedTransitions: PaymentAttemptId[] = [];
    const settlePayment = (
      input: { readonly orderId: OrderId; readonly id: PaymentAttemptId },
      state: "paid" | "failed" | "cancelled" | "expired",
      timestamp: Temporal.Instant,
      settleAttempt: ReturnType<typeof markPaymentAttemptPaid>
    ) =>
      transaction(
        Effect.gen(function* () {
          const [changedOrder] = yield* db
            .update(orders)
            .set({
              paymentState: state,
              paidAt: state === "paid" ? timestamp : undefined,
            })
            .where(
              and(
                eq(orders.id, input.orderId),
                eq(orders.activePaymentAttemptId, input.id),
                eq(orders.paymentState, "pending")
              )
            )
            .returning({ id: orders.id });

          if (changedOrder) {
            const attempt = yield* settleAttempt;
            if (!attempt)
              return yield* Effect.die("Missing active payment attempt");
            return {
              attempt: toPaymentAttempt(attempt),
              changed: true,
              timestamp,
            };
          }

          const [attempt] = yield* db
            .select()
            .from(paymentAttempts)
            .where(
              and(
                eq(paymentAttempts.orderId, input.orderId),
                eq(paymentAttempts.id, input.id)
              )
            );
          if (!attempt)
            return yield* Effect.die("Missing payment attempt on replay");
          return {
            attempt: toPaymentAttempt(attempt),
            changed: false,
            timestamp: attempt.updatedAt,
          };
        })
      );
    const handler: AdmittingOrderPaymentHandler<unknown> = {
      load: (orderId) =>
        db
          .select()
          .from(orders)
          .where(eq(orders.id, orderId))
          .pipe(
            Effect.map(([found]) =>
              found ? { ...found, logFields: { orderId } } : null
            )
          ),
      admitNexi: (input) =>
        transaction(
          Effect.gen(function* () {
            const snapshot = Schema.decodeUnknownOption(accountingDetails)(
              input.details
            );
            if (snapshot._tag === "None")
              return yield* Effect.die("Invalid synthetic accounting data");
            const attempt = yield* insertPaymentAttempt({
              ...input,
              provider: "nexi",
              workspaceReservationId: null,
            });
            yield* db
              .update(orders)
              .set({
                activePaymentAttemptId: attempt.id,
                paymentState: "pending",
              })
              .where(eq(orders.id, input.orderId));
            snapshots.set(attempt.id, Object.freeze(snapshot.value));
            return toPaymentAttempt(attempt);
          })
        ),
      admitInternal: () => Effect.die("Synthetic fixture admits Nexi payments"),
      attachProviderSession: ({ id, securityToken, providerRedirectUrl }) =>
        db
          .update(paymentAttempts)
          .set({
            state: "pending",
            securityToken,
            providerRedirectUrl,
            providerOrderCreatedAt: Temporal.Now.instant(),
          })
          .where(eq(paymentAttempts.id, id))
          .returning()
          .pipe(Effect.map(([attempt]) => toPaymentAttempt(attempt!))),
      markPaid: (input) =>
        settlePayment(
          input,
          "paid",
          input.paidAt,
          markPaymentAttemptPaid(input)
        ),
      markTerminal: (input) => {
        const terminalAt = Temporal.Now.instant();
        return settlePayment(
          input,
          input.state,
          terminalAt,
          markPaymentAttemptTerminal({
            ...input,
            fromAttemptStates: input.fromAttemptStates ?? [
              "created",
              "pending",
            ],
            terminalAt,
          })
        );
      },
      fulfill: (orderId) =>
        Effect.sync(() => {
          fulfilled.add(orderId);
        }),
      scheduleFulfillment: ({ orderId }) =>
        Effect.sync(() => {
          fulfilled.add(orderId);
        }),
      startRecovery: ({ paymentAttemptId }) =>
        Effect.sync(() => {
          recoveries.add(paymentAttemptId);
        }),
      resumeRecovery: ({ paymentAttemptId }) =>
        Effect.sync(() => recoveries.has(paymentAttemptId)),
    };

    let status: PaymentVerificationResult["status"] = "success";
    const operationId = NexiOperationIdSchema.make(crypto.randomUUID());
    const dependencies = Layer.mergeAll(
      PaymentAttemptRepository.Default,
      WebhookEventRepository.Default
    ).pipe(
      Layer.provide(testDatabase.layer),
      Layer.merge(
        Layer.mergeAll(
          Layer.succeed(
            OrderPaymentHandlers,
            OrderPaymentHandlers.make({ "pass-purchase": handler }, (orderId) =>
              findOrderKind(orderId).pipe(Effect.provide(testDatabase.layer))
            )
          ),
          Layer.mock(NexiService, {
            createHostedPaymentPage: (input) =>
              Effect.succeed({
                orderId: input.orderId,
                hostedPage: "https://nexi.test/payment",
                securityToken: "synthetic-session",
              }),
            verifyPaymentOutcome: (input) =>
              Effect.succeed({
                status,
                provider: {
                  orderId: input.orderId,
                  operationId,
                  operationCount: 1,
                  amount: input.amount,
                  currency: input.currency,
                  orderStatus: status === "failure" ? "DECLINED" : "EXECUTED",
                  captureExecuted: status === "success",
                },
                mismatches: [],
              }),
          }),
          Layer.mock(CheckoutAnalytics, {
            paymentCompleted: ({ attempt }) =>
              Effect.sync(() => {
                reportedTransitions.push(attempt.id);
              }),
            paymentAbandoned: () => Effect.void,
            paymentFailed: ({ attempt }) =>
              Effect.sync(() => {
                reportedTransitions.push(attempt.id);
              }),
          }),
          Layer.mock(PaymentRefundService, {})
        )
      )
    );
    const entryPoints = Layer.mergeAll(
      ProviderPaymentFinalizationService.Default,
      LatePaymentVerificationService.Default,
      NexiWebhookService.Default
    ).pipe(Layer.provideMerge(dependencies));

    const admit = (details: { description: string }) =>
      startNexiPaymentSession({
        kind: order.kind,
        orderId: order.id,
        amount: { value: 29_000, exponent: 2, currency: "CZK" },
        locale: "en-US",
        correlationId: order.correlationId,
        customer: { name: "Synthetic Buyer" },
        details,
        beforeAttempt: Effect.void,
      }).pipe(Effect.scoped);

    return {
      order,
      admit,
      setOutcome: (outcome: PaymentVerificationResult["status"]) => {
        status = outcome;
      },
      notify: (
        providerOrderId: string,
        operationResult: "EXECUTED" | "DECLINED"
      ) =>
        Effect.flatMap(NexiWebhookService, (webhook) =>
          webhook.processNotification({
            eventId: crypto.randomUUID(),
            securityToken: "synthetic-session",
            operation: {
              orderId: providerOrderId,
              operationId: crypto.randomUUID(),
              operationType: "CAPTURE",
              operationResult,
              operationAmount: "29000",
              operationCurrency: "CZK",
            },
          })
        ),
      snapshots,
      recoveries,
      fulfilled,
      reportedTransitions,
      entryPoints,
    };
  });

  const run = <A, E, R>(
    scenario: (setup: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>
  ) =>
    Effect.gen(function* () {
      const setup = yield* fixture;
      return yield* scenario(setup).pipe(Effect.provide(setup.entryPoints));
    }).pipe(Effect.provide(testDatabase.layer), Effect.runPromise);

  test("admits a Nexi session and finalizes its payment with the same kind handler", () =>
    run(({ order, admit, snapshots, fulfilled }) =>
      Effect.gen(function* () {
        const details = { description: "Original accounting facts" };
        const { attachedAttempt } = yield* admit(details);
        details.description = "Changed after admission";
        expect(attachedAttempt.workspaceReservationId).toBeNull();
        expect(snapshots.get(attachedAttempt.id)).toEqual({
          description: "Original accounting facts",
        });

        const finalization = yield* ProviderPaymentFinalizationService;
        expect(
          yield* finalization.finalizePendingProviderPayment({
            orderId: order.id,
          })
        ).toBe("paid");
        expect(fulfilled.has(order.id)).toBe(true);
        const attempts = yield* PaymentAttemptRepository;
        expect((yield* attempts.findById(attachedAttempt.id))?.state).toBe(
          "paid"
        );
      })
    ));

  test("recovers a terminal payment through standalone status verification", () =>
    run(({ order, admit, setOutcome, recoveries }) =>
      Effect.gen(function* () {
        const { attachedAttempt } = yield* admit({
          description: "Terminal checkout",
        });
        const finalization = yield* ProviderPaymentFinalizationService;
        setOutcome("failure");
        expect(
          yield* finalization.finalizePendingProviderPayment({
            orderId: order.id,
          })
        ).toBe("terminal");

        setOutcome("success");
        const verification = yield* LatePaymentVerificationService;
        expect(
          yield* verification.startRecoveryIfSettled({ orderId: order.id })
        ).toBe("recovery_started");
        expect(recoveries.has(attachedAttempt.id)).toBe(true);
      })
    ));

  test.each(["success", "failure"] as const)(
    "distinct webhook events preserve the first %s transition",
    (outcome) =>
      run(({ admit, notify, order, reportedTransitions, setOutcome }) =>
        Effect.gen(function* () {
          const { db } = yield* WorkspaceDatabase;
          const attempts = yield* PaymentAttemptRepository;
          const { attachedAttempt, hostedPaymentPage } = yield* admit({
            description: "Webhook replay",
          });
          setOutcome(outcome);
          const operationResult =
            outcome === "success" ? "EXECUTED" : "DECLINED";

          const first = yield* notify(
            hostedPaymentPage.orderId,
            operationResult
          );
          expect(first.status).toBe("accepted");
          const firstAttempt = yield* attempts.findById(attachedAttempt.id);
          const [firstOrder] = yield* db
            .select()
            .from(orders)
            .where(eq(orders.id, order.id));
          expect(firstAttempt?.state).toBe(
            outcome === "success" ? "paid" : "failed"
          );
          if (outcome === "success") expect(firstOrder?.paidAt).not.toBeNull();

          const replay = yield* notify(
            hostedPaymentPage.orderId,
            operationResult
          );
          expect(replay.status).toBe("accepted");
          expect(replay.eventId).not.toBe(first.eventId);
          const replayedAttempt = yield* attempts.findById(attachedAttempt.id);
          const [replayedOrder] = yield* db
            .select()
            .from(orders)
            .where(eq(orders.id, order.id));

          expect(reportedTransitions).toEqual([attachedAttempt.id]);
          expect(replayedAttempt?.updatedAt?.toString()).toBe(
            firstAttempt?.updatedAt?.toString()
          );
          expect(replayedOrder?.paidAt?.toString()).toBe(
            firstOrder?.paidAt?.toString()
          );
        })
      )
  );

  test.each(["paid", "late recovery"] as const)(
    "dispatches a verified webhook to %s",
    (outcome) =>
      run(({ admit, notify, setOutcome, order, recoveries, fulfilled }) =>
        Effect.gen(function* () {
          const { attachedAttempt, hostedPaymentPage } = yield* admit({
            description: "Webhook checkout",
          });
          if (outcome === "late recovery") {
            setOutcome("failure");
            expect(
              (yield* notify(hostedPaymentPage.orderId, "DECLINED")).status
            ).toBe("accepted");
            setOutcome("success");
          }
          expect(
            (yield* notify(hostedPaymentPage.orderId, "EXECUTED")).status
          ).toBe("accepted");
          expect(fulfilled.has(order.id)).toBe(outcome === "paid");
          expect(recoveries.has(attachedAttempt.id)).toBe(
            outcome === "late recovery"
          );
        })
      )
  );
});
