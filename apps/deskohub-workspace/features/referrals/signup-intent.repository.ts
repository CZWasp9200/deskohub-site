import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { promotionCodes } from "@/db/schema/discounts";
import {
  referralAttributions,
  referralCodes,
  referralSignupIntents,
} from "@/db/schema/referrals";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  canonicalPromotionCodeSchema,
  type PromotionCodeId,
} from "@/features/discounts/persistence-contracts";
import type { ReferralCode } from "./client";

/** The referral code a first-time profile completion asked to record. */
export type ReferralSignupIntent = {
  readonly promotionCodeId: PromotionCodeId;
  readonly referrerDotyposCustomerId: DotyposCustomerId;
};

/** A stored intent with the code text that acceptance takes. */
type PendingReferralSignupIntent = ReferralSignupIntent & {
  readonly code: string;
};

type ReferralSignupIntentError = EffectDrizzleQueryError | SqlError;

/**
 * Writes the intent through the caller's transaction executor, so it commits
 * or rolls back with the customer link that the same completion created.
 * Selecting from the code registry instead of inserting values means a code
 * deleted since it was checked writes nothing rather than failing the link.
 */
export const insertReferralSignupIntent = (
  executor: WorkspaceDatabaseClient,
  customerAccountId: CustomerAccountId,
  intent: ReferralSignupIntent
) =>
  executor
    .insert(referralSignupIntents)
    .select(
      executor
        .select({
          customerAccountId: sql<string>`${customerAccountId}`.as(
            "customer_account_id"
          ),
          promotionCodeId: referralCodes.promotionCodeId,
          referrerDotyposCustomerId: referralCodes.referrerDotyposCustomerId,
        })
        .from(referralCodes)
        .where(
          and(
            eq(referralCodes.promotionCodeId, intent.promotionCodeId),
            eq(
              referralCodes.referrerDotyposCustomerId,
              intent.referrerDotyposCustomerId
            )
          )
        )
    )
    .onConflictDoNothing()
    .pipe(Effect.asVoid);

interface IReferralSignupIntentRepository {
  /** The registry identity of a code that was just checked as available. */
  readonly findCodeTarget: (
    code: ReferralCode
  ) => Effect.Effect<
    ReferralSignupIntent | undefined,
    ReferralSignupIntentError
  >;
  readonly find: (
    customerAccountId: CustomerAccountId
  ) => Effect.Effect<
    PendingReferralSignupIntent | undefined,
    ReferralSignupIntentError
  >;
  /** Removes the intent only while it still names the given code. */
  readonly remove: (
    customerAccountId: CustomerAccountId,
    promotionCodeId: PromotionCodeId
  ) => Effect.Effect<void, ReferralSignupIntentError>;
  /** The code a customer's permanent attribution came from, if any. */
  readonly findAttributedCode: (
    invitedDotyposCustomerId: DotyposCustomerId
  ) => Effect.Effect<PromotionCodeId | undefined, ReferralSignupIntentError>;
}

export class ReferralSignupIntentRepository extends Context.Service<
  ReferralSignupIntentRepository,
  IReferralSignupIntentRepository
>()("@deskohub-workspace/referrals/ReferralSignupIntentRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const findCodeTarget = Effect.fn(
        "ReferralSignupIntentRepository.findCodeTarget"
      )((code: ReferralCode) =>
        db
          .select({
            promotionCodeId: referralCodes.promotionCodeId,
            referrerDotyposCustomerId: referralCodes.referrerDotyposCustomerId,
          })
          .from(referralCodes)
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, referralCodes.promotionCodeId)
          )
          .where(
            and(
              eq(promotionCodes.code, canonicalPromotionCodeSchema.make(code)),
              eq(promotionCodes.kind, "referral")
            )
          )
          .limit(1)
          .pipe(Effect.map(([target]) => target))
      );

      const find = Effect.fn("ReferralSignupIntentRepository.find")(
        (customerAccountId: CustomerAccountId) =>
          db
            .select({
              code: promotionCodes.code,
              promotionCodeId: referralSignupIntents.promotionCodeId,
              referrerDotyposCustomerId:
                referralSignupIntents.referrerDotyposCustomerId,
            })
            .from(referralSignupIntents)
            .innerJoin(
              promotionCodes,
              eq(promotionCodes.id, referralSignupIntents.promotionCodeId)
            )
            .where(
              eq(referralSignupIntents.customerAccountId, customerAccountId)
            )
            .limit(1)
            .pipe(Effect.map(([intent]) => intent))
      );

      const remove = Effect.fn("ReferralSignupIntentRepository.remove")(
        (
          customerAccountId: CustomerAccountId,
          promotionCodeId: PromotionCodeId
        ) =>
          db
            .delete(referralSignupIntents)
            .where(
              and(
                eq(referralSignupIntents.customerAccountId, customerAccountId),
                eq(referralSignupIntents.promotionCodeId, promotionCodeId)
              )
            )
            .pipe(Effect.asVoid)
      );

      const findAttributedCode = Effect.fn(
        "ReferralSignupIntentRepository.findAttributedCode"
      )((invitedDotyposCustomerId: DotyposCustomerId) =>
        db
          .select({ promotionCodeId: referralAttributions.promotionCodeId })
          .from(referralAttributions)
          .where(
            eq(
              referralAttributions.invitedDotyposCustomerId,
              invitedDotyposCustomerId
            )
          )
          .limit(1)
          .pipe(Effect.map(([attribution]) => attribution?.promotionCodeId))
      );

      return {
        findCodeTarget,
        find,
        remove,
        findAttributedCode,
      } satisfies IReferralSignupIntentRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
