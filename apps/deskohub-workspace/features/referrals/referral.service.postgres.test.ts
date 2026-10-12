import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
  ExternalAPIError,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  promotionCodes,
  referralAttributions,
  referralCodes,
  workspaceReservations,
} from "@/db/schema";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { canonicalPromotionCodeSchema } from "@/features/discounts/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { ReferralService } from "./referral.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const uniqueId = () => crypto.randomUUID();
const uniqueDotyposId = () =>
  `${Math.floor(Math.random() * 900_000) + 100_000}${Math.floor(
    Math.random() * 900
  )}` as DotyposCustomerId;

const insertAuthUser = async (accountId: CustomerAccountId) => {
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [accountId, `${accountId}@deskohub.test`]
  );
};

const insertReferralFixture = async (input: {
  readonly inviteeCustomerId: DotyposCustomerId;
  readonly ownerCustomerId: DotyposCustomerId;
  readonly code: string;
}) => {
  const [promotion] = await Effect.runPromise(
    testDatabase!.db
      .insert(promotionCodes)
      .values({
        kind: "referral",
        code: canonicalPromotionCodeSchema.make(input.code),
        enabled: true,
      })
      .returning({ id: promotionCodes.id })
  );
  await Effect.runPromise(
    testDatabase!.db.insert(referralCodes).values({
      promotionCodeId: promotion!.id,
      referrerDotyposCustomerId: input.ownerCustomerId,
    })
  );
  await Effect.runPromise(
    testDatabase!.db.insert(referralAttributions).values({
      invitedDotyposCustomerId: input.inviteeCustomerId,
      referrerDotyposCustomerId: input.ownerCustomerId,
      promotionCodeId: promotion!.id,
    })
  );
  return {
    promotionCodeId: promotion!.id,
    cleanup: async () => {
      await testDatabase!.pool.query(
        "delete from referral_attributions where invited_dotypos_customer_id = $1",
        [input.inviteeCustomerId]
      );
      await testDatabase!.pool.query(
        "delete from referral_codes where promotion_code_id = $1",
        [promotion!.id]
      );
      await testDatabase!.pool.query(
        "delete from promotion_codes where id = $1",
        [promotion!.id]
      );
    },
  };
};

const makeLiveConfirmedReservation = (
  id: DotyposReservationId,
  endDate = Temporal.Now.instant().subtract({ hours: 24 }).toString()
) =>
  ({
    id,
    status: "CONFIRMED",
    endDate,
  }) as DotyposReservation;

const makeReferralLayer = (
  identity: {
    readonly accountId: CustomerAccountId;
    readonly dotyposCustomerId: DotyposCustomerId;
  },
  reservations: readonly DotyposReservation[] = [],
  listReservations: DotyposService["Service"]["listReservations"] = () =>
    Effect.succeed(reservations)
) => {
  const databaseLayer = Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.of({ db: testDatabase!.db })
  );
  const lockLayer = WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool);
  const accountLinksLayer = CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(Layer.mergeAll(databaseLayer, lockLayer))
  );

  return ReferralService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        databaseLayer,
        lockLayer,
        accountLinksLayer,
        Layer.succeed(CustomerAccountResolver, {
          resolve: Effect.succeed(identity),
        }),
        Layer.mock(DotyposService, {
          listReservations,
        } as Partial<DotyposService["Service"]>)
      )
    )
  );
};

describe.skipIf(!testDatabase)("ReferralService on disposable Postgres", () => {
  test("requires an active referrer even for an existing same-referrer attribution after a paid booking", async () => {
    const inviteeAccountId = customerAccountIdSchema.make(uniqueId());
    const ownerAccountId = customerAccountIdSchema.make(uniqueId());
    const inviteeCustomerId = uniqueDotyposId();
    const ownerCustomerId = uniqueDotyposId();
    const code = "RFL12345";
    let promotionCodeId: string | undefined;

    await insertAuthUser(inviteeAccountId);
    await insertAuthUser(ownerAccountId);
    await testDatabase!.pool.query(
      `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2), ($3, $4)`,
      [inviteeAccountId, inviteeCustomerId, ownerAccountId, ownerCustomerId]
    );

    try {
      const [promotion] = await Effect.runPromise(
        testDatabase!.db
          .insert(promotionCodes)
          .values({
            kind: "referral",
            code: canonicalPromotionCodeSchema.make(code),
            enabled: true,
          })
          .returning({ id: promotionCodes.id })
      );
      promotionCodeId = promotion!.id;
      await Effect.runPromise(
        testDatabase!.db.insert(referralCodes).values({
          promotionCodeId: promotion!.id,
          referrerDotyposCustomerId: ownerCustomerId,
        })
      );
      await Effect.runPromise(
        testDatabase!.db.insert(referralAttributions).values({
          invitedDotyposCustomerId: inviteeCustomerId,
          referrerDotyposCustomerId: ownerCustomerId,
          promotionCodeId: promotion!.id,
        })
      );
      await Effect.runPromise(
        testDatabase!.db.insert(workspaceReservations).values({
          checkoutAttemptKey: checkoutAttemptKeySchema.make(
            `referral-${uniqueId()}`
          ),
          dotyposCustomerId: inviteeCustomerId,
          dotyposReservationId:
            `reservation-${uniqueId()}` as DotyposReservationId,
          reservationState: "confirmed",
          paymentState: "paid",
          paidAt: Temporal.Now.instant(),
          fulfillmentState: "not_started",
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
        })
      );

      const activeRetry = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* referrals.acceptReferral({
            code,
            customerAccountId: inviteeAccountId,
            dotyposCustomerId: inviteeCustomerId,
          });
        }).pipe(
          Effect.provide(
            makeReferralLayer({
              accountId: inviteeAccountId,
              dotyposCustomerId: inviteeCustomerId,
            })
          )
        )
      );
      expect(activeRetry).toEqual({ kind: "already_accepted" });

      await testDatabase!.pool.query(
        `update auth."user" set deletion_requested_at = now() where id = $1`,
        [ownerAccountId]
      );
      const unavailableRetry = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* Effect.result(
            referrals.acceptReferral({
              code,
              customerAccountId: inviteeAccountId,
              dotyposCustomerId: inviteeCustomerId,
            })
          );
        }).pipe(
          Effect.provide(
            makeReferralLayer({
              accountId: inviteeAccountId,
              dotyposCustomerId: inviteeCustomerId,
            })
          )
        )
      );
      expect(unavailableRetry).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ReferralError", reason: "unavailable" },
      });
    } finally {
      await testDatabase!.pool.query(
        `delete from referral_attributions where invited_dotypos_customer_id = $1`,
        [inviteeCustomerId]
      );
      await testDatabase!.pool.query(
        `delete from workspace_reservations where dotypos_customer_id = $1`,
        [inviteeCustomerId]
      );
      if (promotionCodeId) {
        await testDatabase!.pool.query(
          `delete from referral_codes where promotion_code_id = $1`,
          [promotionCodeId]
        );
        await testDatabase!.pool.query(
          `delete from promotion_codes where id = $1`,
          [promotionCodeId]
        );
      }
      await testDatabase!.pool.query(
        `delete from customer_account_links where customer_account_id = any($1)`,
        [[inviteeAccountId, ownerAccountId]]
      );
      await testDatabase!.pool.query(
        `delete from auth."user" where id = any($1)`,
        [[inviteeAccountId, ownerAccountId]]
      );
    }
  });

  test("serializes concurrent opposite attributions without admitting a cycle", async () => {
    const accountA = customerAccountIdSchema.make(uniqueId());
    const accountB = customerAccountIdSchema.make(uniqueId());
    const customerA = uniqueDotyposId();
    const customerB = uniqueDotyposId();
    const codeA = canonicalPromotionCodeSchema.make(
      `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`
    );
    const codeB = canonicalPromotionCodeSchema.make(
      `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`
    );
    let promotionA: string | undefined;
    let promotionB: string | undefined;

    await insertAuthUser(accountA);
    await insertAuthUser(accountB);
    await testDatabase!.pool.query(
      "insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2), ($3, $4)",
      [accountA, customerA, accountB, customerB]
    );

    try {
      const [a] = await Effect.runPromise(
        testDatabase!.db
          .insert(promotionCodes)
          .values({ kind: "referral", code: codeA, enabled: true })
          .returning({ id: promotionCodes.id })
      );
      const [b] = await Effect.runPromise(
        testDatabase!.db
          .insert(promotionCodes)
          .values({ kind: "referral", code: codeB, enabled: true })
          .returning({ id: promotionCodes.id })
      );
      promotionA = a!.id;
      promotionB = b!.id;
      await Effect.runPromise(
        testDatabase!.db.insert(referralCodes).values([
          {
            promotionCodeId: promotionA,
            referrerDotyposCustomerId: customerA,
          },
          {
            promotionCodeId: promotionB,
            referrerDotyposCustomerId: customerB,
          },
        ])
      );

      const outcomes = await Promise.all([
        Effect.runPromise(
          Effect.gen(function* () {
            const referrals = yield* ReferralService;
            return yield* Effect.result(
              referrals.acceptReferral({
                code: codeB,
                customerAccountId: accountA,
                dotyposCustomerId: customerA,
              })
            );
          }).pipe(
            Effect.provide(
              makeReferralLayer({
                accountId: accountA,
                dotyposCustomerId: customerA,
              })
            )
          )
        ),
        Effect.runPromise(
          Effect.gen(function* () {
            const referrals = yield* ReferralService;
            return yield* Effect.result(
              referrals.acceptReferral({
                code: codeA,
                customerAccountId: accountB,
                dotyposCustomerId: customerB,
              })
            );
          }).pipe(
            Effect.provide(
              makeReferralLayer({
                accountId: accountB,
                dotyposCustomerId: customerB,
              })
            )
          )
        ),
      ]);

      expect(outcomes.filter(({ _tag }) => _tag === "Success")).toHaveLength(1);
      expect(outcomes.filter(({ _tag }) => _tag === "Failure")).toHaveLength(1);
      const edges = await testDatabase!.pool.query(
        "select invited_dotypos_customer_id, referrer_dotypos_customer_id from referral_attributions where invited_dotypos_customer_id = any($1)",
        [[customerA, customerB]]
      );
      expect(edges.rows).toHaveLength(1);
      expect(
        edges.rows.some(
          (edge) =>
            edge.invited_dotypos_customer_id === customerA &&
            edge.referrer_dotypos_customer_id === customerB
        ) &&
          edges.rows.some(
            (edge) =>
              edge.invited_dotypos_customer_id === customerB &&
              edge.referrer_dotypos_customer_id === customerA
          )
      ).toBe(false);
    } finally {
      await testDatabase!.pool.query(
        "delete from referral_attributions where invited_dotypos_customer_id = any($1)",
        [[customerA, customerB]]
      );
      for (const promotionId of [promotionA, promotionB]) {
        if (!promotionId) continue;
        await testDatabase!.pool.query(
          "delete from referral_codes where promotion_code_id = $1",
          [promotionId]
        );
        await testDatabase!.pool.query(
          "delete from promotion_codes where id = $1",
          [promotionId]
        );
      }
      await testDatabase!.pool.query(
        "delete from customer_account_links where customer_account_id = any($1)",
        [[accountA, accountB]]
      );
      await testDatabase!.pool.query(
        'delete from auth."user" where id = any($1)',
        [[accountA, accountB]]
      );
    }
  });

  test("keeps a known unpaid hold distinct from an older confirmed booking without local evidence", async () => {
    const unpaidCustomer = uniqueDotyposId();
    const unpaidOwner = uniqueDotyposId();
    const unknownCustomer = uniqueDotyposId();
    const unknownOwner = uniqueDotyposId();
    const unpaidReservationId = ("unpaid-" +
      uniqueId()) as DotyposReservationId;
    const unpaidReferral = await insertReferralFixture({
      inviteeCustomerId: unpaidCustomer,
      ownerCustomerId: unpaidOwner,
      code: `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    });
    const unknownReferral = await insertReferralFixture({
      inviteeCustomerId: unknownCustomer,
      ownerCustomerId: unknownOwner,
      code: `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    });
    await Effect.runPromise(
      testDatabase!.db.insert(workspaceReservations).values({
        checkoutAttemptKey: checkoutAttemptKeySchema.make(
          `referral-unpaid-${uniqueId()}`
        ),
        dotyposCustomerId: unpaidCustomer,
        dotyposReservationId: unpaidReservationId,
        reservationState: "held",
        paymentState: "failed",
        fulfillmentState: "not_started",
        reservationDetails: {
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        },
        locale: "en-US",
        reservationHoldExpiresAt: Temporal.Now.instant().add({ hours: 1 }),
      })
    );

    try {
      const unpaidCandidate = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* referrals.resolveInvitationCandidate({
            dotyposCustomerId: unpaidCustomer,
            locale: "en-US",
          });
        }).pipe(
          Effect.provide(
            makeReferralLayer(
              {
                accountId: customerAccountIdSchema.make(uniqueId()),
                dotyposCustomerId: unpaidCustomer,
              },
              [makeLiveConfirmedReservation(unpaidReservationId)]
            )
          )
        )
      );
      const unknownCandidate = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* referrals.resolveInvitationCandidate({
            dotyposCustomerId: unknownCustomer,
            locale: "en-US",
          });
        }).pipe(
          Effect.provide(
            makeReferralLayer(
              {
                accountId: customerAccountIdSchema.make(uniqueId()),
                dotyposCustomerId: unknownCustomer,
              },
              [
                makeLiveConfirmedReservation(
                  `untracked-${uniqueId()}` as DotyposReservationId
                ),
              ]
            )
          )
        )
      );

      expect(unpaidCandidate?.claim?.kind).toBe("referral_invitation");
      expect(unknownCandidate).toBeUndefined();
    } finally {
      await testDatabase!.pool.query(
        "delete from workspace_reservations where dotypos_customer_id = $1",
        [unpaidCustomer]
      );
      await unpaidReferral.cleanup();
      await unknownReferral.cleanup();
    }
  });

  test("retains local paid first-booking evidence after auth deletion and relinking", async () => {
    const oldAccountId = customerAccountIdSchema.make(uniqueId());
    const newAccountId = customerAccountIdSchema.make(uniqueId());
    const inviteeCustomerId = uniqueDotyposId();
    const ownerCustomerId = uniqueDotyposId();
    const ownerAccountId = customerAccountIdSchema.make(uniqueId());
    const paidReservationId = `paid-${uniqueId()}` as DotyposReservationId;
    const referral = await insertReferralFixture({
      inviteeCustomerId,
      ownerCustomerId,
      code: `RFL${uniqueId().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    });
    await insertAuthUser(oldAccountId);
    await insertAuthUser(newAccountId);
    await insertAuthUser(ownerAccountId);
    await testDatabase!.pool.query(
      "insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2), ($3, $4)",
      [oldAccountId, inviteeCustomerId, ownerAccountId, ownerCustomerId]
    );
    await Effect.runPromise(
      testDatabase!.db.insert(workspaceReservations).values({
        checkoutAttemptKey: checkoutAttemptKeySchema.make(
          `referral-paid-${uniqueId()}`
        ),
        dotyposCustomerId: inviteeCustomerId,
        dotyposReservationId: paidReservationId,
        reservationState: "confirmed",
        paymentState: "paid",
        paidAt: Temporal.Now.instant(),
        fulfillmentState: "not_started",
        reservationDetails: {
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        },
        locale: "en-US",
      })
    );

    try {
      await testDatabase!.pool.query('delete from auth."user" where id = $1', [
        oldAccountId,
      ]);
      await testDatabase!.pool.query(
        "insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)",
        [newAccountId, inviteeCustomerId]
      );

      const candidate = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* referrals.resolveInvitationCandidate({
            dotyposCustomerId: inviteeCustomerId,
            locale: "en-US",
          });
        }).pipe(
          Effect.provide(
            makeReferralLayer({
              accountId: newAccountId,
              dotyposCustomerId: inviteeCustomerId,
            })
          )
        )
      );
      const link = await testDatabase!.pool.query(
        "select customer_account_id from customer_account_links where dotypos_customer_id = $1",
        [inviteeCustomerId]
      );

      expect(link.rows).toEqual([{ customer_account_id: newAccountId }]);
      expect(candidate).toBeUndefined();
    } finally {
      await testDatabase!.pool.query(
        "delete from workspace_reservations where dotypos_customer_id = $1",
        [inviteeCustomerId]
      );
      await referral.cleanup();
      await testDatabase!.pool.query(
        "delete from customer_account_links where customer_account_id = any($1)",
        [[newAccountId, ownerAccountId]]
      );
      await testDatabase!.pool.query(
        'delete from auth."user" where id = any($1)',
        [[newAccountId, ownerAccountId]]
      );
    }
  });

  test("finds only currently usable referral codes without issuing codes or attribution", async () => {
    const uniqueCode = () =>
      `RFA${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const promotionCodeIds: string[] = [];
    const accountIds: CustomerAccountId[] = [];
    const insertCode = async (input: {
      readonly owner: "active" | "deletion-requested" | "unlinked";
      readonly kind?: "referral" | "discount";
      readonly enabled?: boolean;
      readonly validFrom?: Temporal.Instant;
      readonly validUntil?: Temporal.Instant;
    }) => {
      const code = uniqueCode();
      const ownerCustomerId = uniqueDotyposId();
      const [promotion] = await Effect.runPromise(
        testDatabase!.db
          .insert(promotionCodes)
          .values({
            kind: input.kind ?? "referral",
            code: canonicalPromotionCodeSchema.make(code),
            enabled: input.enabled ?? true,
            validFrom: input.validFrom,
            validUntil: input.validUntil,
          })
          .returning({ id: promotionCodes.id })
      );
      promotionCodeIds.push(promotion!.id);
      if ((input.kind ?? "referral") === "referral") {
        await Effect.runPromise(
          testDatabase!.db.insert(referralCodes).values({
            promotionCodeId: promotion!.id,
            referrerDotyposCustomerId: ownerCustomerId,
          })
        );
      }
      if (input.owner !== "unlinked") {
        const ownerAccountId = customerAccountIdSchema.make(uniqueId());
        accountIds.push(ownerAccountId);
        await insertAuthUser(ownerAccountId);
        await testDatabase!.pool.query(
          `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
          [ownerAccountId, ownerCustomerId]
        );
        if (input.owner === "deletion-requested") {
          await testDatabase!.pool.query(
            `update auth."user" set deletion_requested_at = now() where id = $1`,
            [ownerAccountId]
          );
        }
      }
      return code;
    };

    try {
      const now = Temporal.Now.instant();
      const available = await insertCode({ owner: "active" });
      const unavailable = await Promise.all([
        insertCode({ owner: "active", enabled: false }),
        insertCode({
          owner: "active",
          validUntil: now.subtract({ hours: 1 }),
        }),
        insertCode({ owner: "active", validFrom: now.add({ hours: 1 }) }),
        insertCode({ owner: "unlinked" }),
        insertCode({ owner: "deletion-requested" }),
        insertCode({ owner: "active", kind: "discount" }),
      ]);
      const countRows = async () => {
        const result = await testDatabase!.pool.query<{
          readonly codes: string;
          readonly attributions: string;
        }>(
          `select (select count(*) from referral_codes) as codes,
                  (select count(*) from referral_attributions) as attributions`
        );
        return result.rows[0];
      };
      const before = await countRows();

      const lookups = await Effect.runPromise(
        Effect.gen(function* () {
          const referrals = yield* ReferralService;
          return yield* Effect.forEach(
            [` ${available.toLowerCase()} `, ...unavailable, "not a code"],
            (code) => referrals.findAvailableCode({ code })
          );
        }).pipe(
          Effect.provide(
            makeReferralLayer({
              accountId: customerAccountIdSchema.make(uniqueId()),
              dotyposCustomerId: uniqueDotyposId(),
            })
          )
        )
      );

      expect(lookups).toEqual([
        available,
        ...unavailable.map(() => undefined),
        undefined,
      ]);
      expect(await countRows()).toEqual(before);
    } finally {
      await testDatabase!.pool.query(
        "delete from promotion_codes where id = any($1)",
        [promotionCodeIds]
      );
      await testDatabase!.pool.query(
        "delete from customer_account_links where customer_account_id = any($1)",
        [accountIds]
      );
      await testDatabase!.pool.query(
        'delete from auth."user" where id = any($1)',
        [accountIds]
      );
    }
  });
});

const createActiveReferrer = async () => {
  const accountId = customerAccountIdSchema.make(uniqueId());
  const dotyposCustomerId = uniqueDotyposId();
  const code = `RFC${uniqueId().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  await insertAuthUser(accountId);
  await testDatabase!.pool.query(
    `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
    [accountId, dotyposCustomerId]
  );
  const [promotion] = await Effect.runPromise(
    testDatabase!.db
      .insert(promotionCodes)
      .values({
        kind: "referral",
        code: canonicalPromotionCodeSchema.make(code),
        enabled: true,
      })
      .returning({ id: promotionCodes.id })
  );
  await Effect.runPromise(
    testDatabase!.db.insert(referralCodes).values({
      promotionCodeId: promotion!.id,
      referrerDotyposCustomerId: dotyposCustomerId,
    })
  );
  return {
    accountId,
    dotyposCustomerId,
    code: canonicalPromotionCodeSchema.make(code),
    promotionCodeId: promotion!.id,
    cleanup: async () => {
      await testDatabase!.pool.query(
        "delete from referral_attributions where promotion_code_id = $1",
        [promotion!.id]
      );
      await testDatabase!.pool.query(
        "delete from promotion_codes where id = $1",
        [promotion!.id]
      );
      await testDatabase!.pool.query(
        "delete from customer_account_links where customer_account_id = $1",
        [accountId]
      );
      await testDatabase!.pool.query('delete from auth."user" where id = $1', [
        accountId,
      ]);
    },
  };
};

const insertPaidBooking = (dotyposCustomerId: DotyposCustomerId) =>
  Effect.runPromise(
    testDatabase!.db.insert(workspaceReservations).values({
      checkoutAttemptKey: checkoutAttemptKeySchema.make(
        `referral-${uniqueId()}`
      ),
      dotyposCustomerId,
      dotyposReservationId: `reservation-${uniqueId()}` as DotyposReservationId,
      reservationState: "confirmed",
      paymentState: "paid",
      paidAt: Temporal.Now.instant(),
      fulfillmentState: "not_started",
      reservationDetails: { kind: "cowork", entryTier: "basic", coffee: false },
      locale: "en-US",
    })
  );

const runReferrals = <A, E>(
  use: (referrals: ReferralService["Service"]) => Effect.Effect<A, E>,
  layer = makeReferralLayer({
    accountId: customerAccountIdSchema.make(uniqueId()),
    dotyposCustomerId: uniqueDotyposId(),
  })
) =>
  Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        return yield* use(yield* ReferralService);
      }).pipe(Effect.provide(layer))
    )
  );

describe.skipIf(!testDatabase)(
  "ReferralService checkout referral evaluation on disposable Postgres",
  () => {
    test("lets a customer without a referral at completion take one at the first checkout, then rejects it after the first paid order", async () => {
      const referrer = await createActiveReferrer();
      // Completed profile without a referral: a linked account, no attribution.
      const inviteeAccountId = customerAccountIdSchema.make(uniqueId());
      const inviteeCustomerId = uniqueDotyposId();
      await insertAuthUser(inviteeAccountId);
      await testDatabase!.pool.query(
        `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
        [inviteeAccountId, inviteeCustomerId]
      );
      try {
        const evaluate = () =>
          runReferrals((referrals) =>
            referrals.evaluateCheckoutReferral({
              code: referrer.code.toLowerCase(),
              dotyposCustomerId: inviteeCustomerId,
            })
          );
        const price = (referralCode?: typeof referrer.code) =>
          runReferrals((referrals) =>
            referrals.resolveInvitationCandidate({
              dotyposCustomerId: inviteeCustomerId,
              locale: "en-US",
              ...(referralCode && { referralCode }),
            })
          );

        expect(await evaluate()).toMatchObject({
          _tag: "Success",
          success: { kind: "eligible", code: referrer.code },
        });
        expect(await price(referrer.code)).toMatchObject({
          _tag: "Success",
          success: {
            discount: {
              adjustment: { kind: "percentage", basisPoints: 1_500 },
            },
            claim: {
              kind: "referral_invitation",
              invitedDotyposCustomerId: inviteeCustomerId,
              referrerDotyposCustomerId: referrer.dotyposCustomerId,
              promotionCodeId: referrer.promotionCodeId,
            },
          },
        });
        expect(await price()).toMatchObject({
          _tag: "Success",
          success: undefined,
        });
        const attributions = await testDatabase!.pool.query(
          "select 1 from referral_attributions where invited_dotypos_customer_id = $1",
          [inviteeCustomerId]
        );
        expect(attributions.rows).toEqual([]);

        await insertPaidBooking(inviteeCustomerId);

        expect(await evaluate()).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ReferralError", reason: "ineligible" },
        });
        expect(await price(referrer.code)).toMatchObject({
          _tag: "Success",
          success: undefined,
        });
      } finally {
        await testDatabase!.pool.query(
          "delete from workspace_reservations where dotypos_customer_id = $1",
          [inviteeCustomerId]
        );
        await testDatabase!.pool.query(
          "delete from customer_account_links where customer_account_id = $1",
          [inviteeAccountId]
        );
        await testDatabase!.pool.query(
          'delete from auth."user" where id = $1',
          [inviteeAccountId]
        );
        await referrer.cleanup();
      }
    });

    test("evaluates guest, attributed, self, and cyclic checkout referrals without writing", async () => {
      const first = await createActiveReferrer();
      const second = await createActiveReferrer();
      const guestCustomerId = uniqueDotyposId();
      const attributedCustomerId = uniqueDotyposId();
      try {
        await Effect.runPromise(
          testDatabase!.db.insert(referralAttributions).values([
            {
              invitedDotyposCustomerId: attributedCustomerId,
              referrerDotyposCustomerId: first.dotyposCustomerId,
              promotionCodeId: first.promotionCodeId,
            },
            // first was invited by second, so second cannot be invited by first.
            {
              invitedDotyposCustomerId: first.dotyposCustomerId,
              referrerDotyposCustomerId: second.dotyposCustomerId,
              promotionCodeId: second.promotionCodeId,
            },
          ])
        );
        const evaluate = (code: string, dotyposCustomerId: DotyposCustomerId) =>
          runReferrals((referrals) =>
            referrals.evaluateCheckoutReferral({ code, dotyposCustomerId })
          );

        expect(await evaluate(first.code, guestCustomerId)).toMatchObject({
          _tag: "Success",
          success: { kind: "eligible" },
        });
        expect(await evaluate(first.code, attributedCustomerId)).toMatchObject({
          _tag: "Success",
          success: { kind: "already_accepted" },
        });
        expect(await evaluate(second.code, attributedCustomerId)).toMatchObject(
          {
            _tag: "Failure",
            failure: { reason: "already_attributed" },
          }
        );
        expect(
          await evaluate(first.code, first.dotyposCustomerId)
        ).toMatchObject({
          _tag: "Failure",
          failure: { reason: "self_referral" },
        });
        expect(
          await evaluate(first.code, second.dotyposCustomerId)
        ).toMatchObject({
          _tag: "Failure",
          failure: { reason: "unavailable" },
        });
        expect(
          (
            await testDatabase!.pool.query(
              "select 1 from referral_attributions where invited_dotypos_customer_id = any($1)",
              [[guestCustomerId, second.dotyposCustomerId]]
            )
          ).rows
        ).toEqual([]);
      } finally {
        await first.cleanup();
        await second.cleanup();
      }
    });

    test("rejects acceptance cleanly when Dotypos history fails inside the attribution transaction", async () => {
      const referrer = await createActiveReferrer();
      const inviteeAccountId = customerAccountIdSchema.make(uniqueId());
      const inviteeCustomerId = uniqueDotyposId();
      await insertAuthUser(inviteeAccountId);
      await testDatabase!.pool.query(
        `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
        [inviteeAccountId, inviteeCustomerId]
      );
      try {
        const identity = {
          accountId: inviteeAccountId,
          dotyposCustomerId: inviteeCustomerId,
        };
        const failingHistory = makeReferralLayer(identity, [], () =>
          Effect.fail(
            new ExternalAPIError({
              operation: "listReservations",
              service: "Dotypos",
              statusCode: 503,
            })
          )
        );

        const acceptance = await runReferrals(
          (referrals) =>
            referrals.acceptReferral({
              code: referrer.code,
              customerAccountId: inviteeAccountId,
              dotyposCustomerId: inviteeCustomerId,
            }),
          failingHistory
        );

        expect(acceptance).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "ReferralError", reason: "unavailable" },
        });
        // The pool connection is still usable after the rollback.
        const attributions = await testDatabase!.pool.query(
          "select 1 from referral_attributions where invited_dotypos_customer_id = $1",
          [inviteeCustomerId]
        );
        expect(attributions.rows).toEqual([]);
      } finally {
        await testDatabase!.pool.query(
          "delete from customer_account_links where customer_account_id = $1",
          [inviteeAccountId]
        );
        await testDatabase!.pool.query(
          'delete from auth."user" where id = $1',
          [inviteeAccountId]
        );
        await referrer.cleanup();
      }
    });
  }
);
