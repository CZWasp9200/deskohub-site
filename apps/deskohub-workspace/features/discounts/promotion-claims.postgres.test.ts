import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Deferred, Effect } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceTransaction,
} from "@/db/database.service";
import {
  discountApplications,
  discountCodes,
  discountProductTargets,
  discounts,
  paymentAttempts,
  promotionCodes,
  vouchers,
} from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { m } from "@/features/i18n";
import type { Money } from "@/shared/money/money";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { waitForPostgresLockWaiter } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AppliedDiscount } from "./contracts";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";
import {
  canonicalPromotionCodeSchema,
  type DiscountApplicationId,
} from "./persistence-contracts";
import { getWorkspaceProductTargetsCovering } from "./product-target";
import { type PromotionClaim, PromotionClaims } from "./promotion-claims";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const product = { kind: "cowork", tier: "basic" } as const;
const locale = "en-US" as const;
const labels = { "en-US": "Claim ledger campaign", "cs-CZ": "Kampaň" };
const subtotal = 35_000;
const czk = (value: number): Money => ({ value, exponent: 2, currency: "CZK" });
const uniqueSuffix = () =>
  crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
const newCustomer = () =>
  (
    Math.floor(Math.random() * 900_000_000) + 100_000_000
  ).toString() as DotyposCustomerId;

/** Runs `effect` in its own Workspace transaction on the test database. */
const inTransaction = <A, E>(
  effect: Effect.Effect<A, E, WorkspaceTransaction>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { transaction } = yield* WorkspaceDatabase;
      return yield* transaction(effect);
    }).pipe(Effect.provide(testDatabase!.layer), Effect.result)
  );

const insertPromotion = async (kind: "discount" | "voucher") => {
  const [promotion] = await Effect.runPromise(
    testDatabase!.db
      .insert(promotionCodes)
      .values({
        kind,
        code: canonicalPromotionCodeSchema.make(`PC${uniqueSuffix()}`),
        enabled: true,
      })
      .returning({ id: promotionCodes.id })
  );
  return promotion!.id;
};

const createDiscountCode = async (maxUses: number | null) => {
  const db = testDatabase!.db;
  const promotionCodeId = await insertPromotion("discount");
  const [storedDiscount] = await Effect.runPromise(
    db
      .insert(discounts)
      .values({ labels, percentageBasisPoints: 1_000 })
      .returning({ id: discounts.id })
  );
  await Effect.runPromise(
    db.insert(discountProductTargets).values({
      discountId: storedDiscount!.id,
      productTarget: getWorkspaceProductTargetsCovering(product)[0],
    })
  );
  const [code] = await Effect.runPromise(
    db
      .insert(discountCodes)
      .values({
        code: canonicalPromotionCodeSchema.make(`DC${uniqueSuffix()}`),
        enabled: true,
        promotionCodeId,
        discountId: storedDiscount!.id,
        maxUses,
        maxUsesPerCustomer: null,
      })
      .returning({ id: discountCodes.id })
  );
  const claim = (customer: DotyposCustomerId): PromotionClaim => ({
    kind: "discount_code",
    codeId: code!.id,
    storedDiscountId: storedDiscount!.id,
    dotyposCustomerId: customer,
    product,
  });
  const application: AppliedDiscount = {
    discount: {
      id: storedDiscount!.id,
      label: labels[locale],
      adjustment: { kind: "percentage", basisPoints: 1_000 },
    },
    subtotalBefore: czk(subtotal),
    amount: czk(subtotal / 10),
    subtotalAfter: czk(subtotal - subtotal / 10),
  };
  return { claim, application, codeId: code!.id };
};

const createVoucher = async (issued: number) => {
  const promotionCodeId = await insertPromotion("voucher");
  const [voucher] = await Effect.runPromise(
    testDatabase!.db
      .insert(vouchers)
      .values({
        promotionCodeId,
        issuedAmountValue: issued,
        issuedAmountExponent: 2,
        issuedAmountCurrency: "CZK",
      })
      .returning({ id: vouchers.id })
  );
  /** The claim and application that take `amount` of `available` credit. */
  const offer = (
    customer: DotyposCustomerId,
    available: number,
    amount = available
  ) => ({
    claim: {
      kind: "voucher",
      voucherId: voucher!.id,
      availableAmount: czk(available),
      dotyposCustomerId: customer,
    } satisfies PromotionClaim,
    application: {
      discount: {
        id: deriveOpaqueDiscountId({
          providerNamespace: "database-voucher",
          providerReference: voucher!.id,
        }),
        label: m.checkoutVoucherLabel({}, { locale }),
        adjustment: { kind: "fixed", amount: czk(available) },
      },
      subtotalBefore: czk(subtotal),
      amount: czk(amount),
      subtotalAfter: czk(subtotal - amount),
    } satisfies AppliedDiscount,
  });
  return { offer, voucherId: voucher!.id };
};

/** A held reservation's new payment attempt with the application persisted. */
const createAttempt = async (
  customer: DotyposCustomerId,
  application: AppliedDiscount
) => {
  const db = testDatabase!.db;
  const reservation = await Effect.runPromise(
    workspaceFixtures(db).reservation({
      stage: { reservation: "held" },
      customer,
    })
  );
  const [attempt] = await Effect.runPromise(
    db
      .insert(paymentAttempts)
      .values({
        workspaceReservationId: reservation.id,
        provider: "nexi",
        providerOrderId: `order-${crypto.randomUUID()}` as never,
        state: "created",
        amountValue: application.subtotalAfter.value,
        amountExponent: 2,
        currency: "CZK",
      })
      .returning({ id: paymentAttempts.id })
  );
  const [persisted] = await Effect.runPromise(
    db
      .insert(discountApplications)
      .values({
        paymentAttemptId: attempt!.id,
        workspaceReservationId: reservation.id,
        sequence: 0,
        publicDiscountId: application.discount.id,
        label: application.discount.label,
        adjustment: application.discount.adjustment,
        productIdentity: product,
        subtotalBeforeValue: application.subtotalBefore.value,
        subtotalBeforeExponent: 2,
        subtotalBeforeCurrency: "CZK",
        appliedAmountValue: application.amount.value,
        appliedAmountExponent: 2,
        appliedAmountCurrency: "CZK",
        subtotalAfterValue: application.subtotalAfter.value,
        subtotalAfterExponent: 2,
        subtotalAfterCurrency: "CZK",
        provenance: { providerNamespace: "test", providerReference: "test" },
      })
      .returning({ id: discountApplications.id })
  );
  return {
    paymentAttemptId: attempt!.id,
    applicationId: persisted!.id as DiscountApplicationId,
  };
};

const admission = (
  offer: {
    readonly claim: PromotionClaim;
    readonly application: AppliedDiscount;
  },
  attempt: {
    readonly paymentAttemptId: PaymentAttemptId;
    readonly applicationId: DiscountApplicationId;
  },
  reservationExpiresAt = Temporal.Now.instant().add({ hours: 1 })
) => ({
  ...offer,
  ...attempt,
  locale,
  reservationCustomerId: offer.claim.dotyposCustomerId,
  reservationExpiresAt,
  firstServiceDate: "2099-01-01",
});

/** Creates the attempt for `offer` and admits its claim. */
const admitNew = async (offer: {
  readonly claim: PromotionClaim;
  readonly application: AppliedDiscount;
}) => {
  const attempt = await createAttempt(
    offer.claim.dotyposCustomerId,
    offer.application
  );
  const result = await inTransaction(
    PromotionClaims.admit(admission(offer, attempt))
  );
  return { attempt, result };
};

const claimRows = async (paymentAttemptId: PaymentAttemptId) =>
  (
    await testDatabase!.pool.query(
      `select 'code' as ledger, state, release_reason, reserved_at is not null as reserved, redeemed_at is not null as redeemed, released_at is not null as released from discount_code_redemptions where payment_attempt_id = $1
       union all
       select 'voucher', state, release_reason, reserved_at is not null, redeemed_at is not null, released_at is not null from voucher_redemptions where payment_attempt_id = $1`,
      [paymentAttemptId]
    )
  ).rows;

const now = () => Temporal.Now.instant();

describe.skipIf(!testDatabase)("PromotionClaims on disposable Postgres", () => {
  test("reserves, redeems and keeps a redeemed claim as it is", async () => {
    const code = await createDiscountCode(null);
    const { attempt, result } = await admitNew(
      (() => {
        const customer = newCustomer();
        return { claim: code.claim(customer), application: code.application };
      })()
    );
    expect(result._tag).toBe("Success");
    expect(await claimRows(attempt.paymentAttemptId)).toEqual([
      {
        ledger: "code",
        state: "reserved",
        release_reason: null,
        reserved: true,
        redeemed: false,
        released: false,
      },
    ]);

    for (let round = 0; round < 2; round += 1) {
      expect(
        await inTransaction(
          PromotionClaims.redeem({
            paymentAttemptId: attempt.paymentAttemptId,
            redeemedAt: now(),
          })
        )
      ).toMatchObject({ _tag: "Success" });
    }
    expect(await claimRows(attempt.paymentAttemptId)).toMatchObject([
      { state: "redeemed", redeemed: true, released: false },
    ]);
    expect(
      await inTransaction(
        PromotionClaims.release({
          paymentAttemptId: attempt.paymentAttemptId,
          releasedAt: now(),
          releaseReason: "cancelled",
        })
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "release",
        reason: "claim_conflict",
        codeId: code.codeId,
      },
    });
    expect(await claimRows(attempt.paymentAttemptId)).toMatchObject([
      { state: "redeemed" },
    ]);
  });

  test("releases once and refuses to redeem a released claim unless readmitting", async () => {
    const voucher = await createVoucher(5_000);
    const customer = newCustomer();
    const { attempt, result } = await admitNew(voucher.offer(customer, 5_000));
    expect(result._tag).toBe("Success");

    for (const reason of ["expired", "a later reason"]) {
      expect(
        await inTransaction(
          PromotionClaims.release({
            paymentAttemptId: attempt.paymentAttemptId,
            releasedAt: now(),
            releaseReason: reason,
          })
        )
      ).toMatchObject({ _tag: "Success" });
    }
    expect(await claimRows(attempt.paymentAttemptId)).toEqual([
      {
        ledger: "voucher",
        state: "released",
        release_reason: "expired",
        reserved: true,
        redeemed: false,
        released: true,
      },
    ]);

    expect(
      await inTransaction(
        PromotionClaims.redeem({
          paymentAttemptId: attempt.paymentAttemptId,
          redeemedAt: now(),
        })
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: {
        operation: "redeem",
        reason: "claim_conflict",
        codeId: voucher.voucherId,
      },
    });

    expect(
      await inTransaction(
        PromotionClaims.redeem({
          paymentAttemptId: attempt.paymentAttemptId,
          redeemedAt: now(),
          readmitReleased: true,
        })
      )
    ).toMatchObject({ _tag: "Success" });
    expect(await claimRows(attempt.paymentAttemptId)).toEqual([
      {
        ledger: "voucher",
        state: "redeemed",
        release_reason: null,
        reserved: true,
        redeemed: true,
        released: false,
      },
    ]);
  });

  test("redeems and releases nothing for an attempt without a claim", async () => {
    const code = await createDiscountCode(null);
    const attempt = await createAttempt(newCustomer(), code.application);
    expect(
      await inTransaction(
        Effect.all([
          PromotionClaims.redeem({
            paymentAttemptId: attempt.paymentAttemptId,
            redeemedAt: now(),
            readmitReleased: true,
          }),
          PromotionClaims.release({
            paymentAttemptId: attempt.paymentAttemptId,
            releasedAt: now(),
            releaseReason: "cancelled",
          }),
        ])
      )
    ).toMatchObject({ _tag: "Success" });
    expect(await claimRows(attempt.paymentAttemptId)).toEqual([]);
  });

  test("a released use is admitted again, and its readmission then exceeds the limit", async () => {
    const code = await createDiscountCode(1);
    const first = await admitNew({
      claim: code.claim(newCustomer()),
      application: code.application,
    });
    expect(first.result._tag).toBe("Success");

    const secondCustomer = newCustomer();
    const refused = await admitNew({
      claim: code.claim(secondCustomer),
      application: code.application,
    });
    expect(refused.result).toMatchObject({
      _tag: "Failure",
      failure: { operation: "reserve", reason: "usage_limit_reached" },
    });

    await inTransaction(
      PromotionClaims.release({
        paymentAttemptId: first.attempt.paymentAttemptId,
        releasedAt: now(),
        releaseReason: "expired",
      })
    );
    const second = await admitNew({
      claim: code.claim(secondCustomer),
      application: code.application,
    });
    expect(second.result._tag).toBe("Success");

    expect(
      await inTransaction(
        PromotionClaims.redeem({
          paymentAttemptId: first.attempt.paymentAttemptId,
          redeemedAt: now(),
          readmitReleased: true,
        })
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: {
        operation: "redeem",
        reason: "usage_limit_reached",
        codeId: code.codeId,
      },
    });
    expect(await claimRows(first.attempt.paymentAttemptId)).toMatchObject([
      { state: "released" },
    ]);
  });

  test("refuses to readmit a released voucher claim whose credit another claim took", async () => {
    const voucher = await createVoucher(5_000);
    const customer = newCustomer();
    const first = await admitNew(voucher.offer(customer, 5_000, 4_000));
    await inTransaction(
      PromotionClaims.release({
        paymentAttemptId: first.attempt.paymentAttemptId,
        releasedAt: now(),
        releaseReason: "expired",
      })
    );
    const second = await admitNew(voucher.offer(customer, 5_000, 2_000));
    expect(second.result._tag).toBe("Success");

    expect(
      await inTransaction(
        PromotionClaims.redeem({
          paymentAttemptId: first.attempt.paymentAttemptId,
          redeemedAt: now(),
          readmitReleased: true,
        })
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: {
        operation: "redeem",
        reason: "claim_conflict",
        codeId: voucher.voucherId,
      },
    });
    expect(await claimRows(first.attempt.paymentAttemptId)).toMatchObject([
      { state: "released" },
    ]);
  });

  test("refuses a customer's second claim of a voucher while the first is reserved", async () => {
    const voucher = await createVoucher(5_000);
    const customer = newCustomer();
    const first = await admitNew(voucher.offer(customer, 5_000, 2_000));
    expect(first.result._tag).toBe("Success");

    const second = await admitNew(voucher.offer(customer, 3_000));
    expect(second.result).toMatchObject({
      _tag: "Failure",
      failure: {
        operation: "reserve",
        reason: "claim_conflict",
        codeId: voucher.voucherId,
      },
    });
    expect(await claimRows(second.attempt.paymentAttemptId)).toEqual([]);
  });

  test("of two admissions racing for a code's last use, the one that waited is refused", async () => {
    const code = await createDiscountCode(1);
    const holder = {
      claim: code.claim(newCustomer()),
      application: code.application,
    };
    const waiter = {
      claim: code.claim(newCustomer()),
      application: code.application,
    };
    const holderAttempt = await createAttempt(
      holder.claim.dotyposCustomerId,
      holder.application
    );
    const waiterAttempt = await createAttempt(
      waiter.claim.dotyposCustomerId,
      waiter.application
    );

    const admitted = await Effect.runPromise(Deferred.make<void>());
    const commit = await Effect.runPromise(Deferred.make<void>());
    const holding = inTransaction(
      PromotionClaims.admit(admission(holder, holderAttempt)).pipe(
        Effect.tap(() => Deferred.succeed(admitted, undefined)),
        Effect.tap(() => Deferred.await(commit))
      )
    );
    await Effect.runPromise(Deferred.await(admitted));

    const waiting = inTransaction(
      PromotionClaims.admit(admission(waiter, waiterAttempt))
    );
    await waitForPostgresLockWaiter(testDatabase!.pool, {
      condition: "locktype = 'transactionid'",
      description: "the second admission waiting on the code row",
    });
    await Effect.runPromise(Deferred.succeed(commit, undefined));

    expect((await holding)._tag).toBe("Success");
    expect(await waiting).toMatchObject({
      _tag: "Failure",
      failure: {
        operation: "reserve",
        reason: "usage_limit_reached",
        codeId: code.codeId,
      },
    });
    expect(await claimRows(waiterAttempt.paymentAttemptId)).toEqual([]);
  });

  test("reports a second claim of the same attempt as a claim conflict", async () => {
    const code = await createDiscountCode(null);
    const offer = {
      claim: code.claim(newCustomer()),
      application: code.application,
    };
    const attempt = await createAttempt(
      offer.claim.dotyposCustomerId,
      offer.application
    );
    expect(
      (await inTransaction(PromotionClaims.admit(admission(offer, attempt))))
        ._tag
    ).toBe("Success");

    const repeated = await inTransaction(
      PromotionClaims.admit(admission(offer, attempt))
    );
    expect(repeated).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "claim_conflict",
      },
    });
    expect(
      repeated._tag === "Failure" && "cause" in repeated.failure
        ? repeated.failure.cause
        : undefined
    ).toBeDefined();
    expect(await claimRows(attempt.paymentAttemptId)).toHaveLength(1);
  });

  test("admits nothing once the hold has ended", async () => {
    const code = await createDiscountCode(null);
    const offer = {
      claim: code.claim(newCustomer()),
      application: code.application,
    };
    const attempt = await createAttempt(
      offer.claim.dotyposCustomerId,
      offer.application
    );
    expect(
      await inTransaction(
        PromotionClaims.admit(
          admission(
            offer,
            attempt,
            Temporal.Now.instant().subtract({ seconds: 1 })
          )
        )
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "PromotionClaimHoldEndedError" },
    });
    expect(await claimRows(attempt.paymentAttemptId)).toEqual([]);
  });
});
