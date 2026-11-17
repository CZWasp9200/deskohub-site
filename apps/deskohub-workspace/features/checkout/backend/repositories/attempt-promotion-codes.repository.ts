import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  discountCodeRedemptions,
  discountCodes,
  promotionCodes,
  referralInvitationClaims,
  voucherRedemptions,
  vouchers,
} from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { CanonicalPromotionCode } from "@/features/discounts/contracts";

/**
 * The codes a payment attempt was priced with, read from the claims its
 * admission recorded, whatever state those claims are in now: the entered
 * discount code or voucher, and the referral code of an invitation.
 */
type AttemptPromotionCodes = {
  readonly enteredCode?: CanonicalPromotionCode;
  readonly referralCode?: CanonicalPromotionCode;
};

export interface IAttemptPromotionCodes {
  readonly find: (
    paymentAttemptId: PaymentAttemptId
  ) => Effect.Effect<AttemptPromotionCodes, EffectDrizzleQueryError>;
}

export class AttemptPromotionCodesRepository extends Context.Service<
  AttemptPromotionCodesRepository,
  IAttemptPromotionCodes
>()("@deskohub-workspace/checkout/AttemptPromotionCodesRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const findDiscountCode = (paymentAttemptId: PaymentAttemptId) =>
        db
          .select({ code: discountCodes.code })
          .from(discountCodeRedemptions)
          .innerJoin(
            discountCodes,
            eq(discountCodes.id, discountCodeRedemptions.codeId)
          )
          .where(eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId))
          .limit(1);

      const findVoucherCode = (paymentAttemptId: PaymentAttemptId) =>
        db
          .select({ code: promotionCodes.code })
          .from(voucherRedemptions)
          .innerJoin(vouchers, eq(vouchers.id, voucherRedemptions.voucherId))
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, vouchers.promotionCodeId)
          )
          .where(eq(voucherRedemptions.paymentAttemptId, paymentAttemptId))
          .limit(1);

      const findReferralCode = (paymentAttemptId: PaymentAttemptId) =>
        db
          .select({ code: promotionCodes.code })
          .from(referralInvitationClaims)
          .innerJoin(
            promotionCodes,
            eq(promotionCodes.id, referralInvitationClaims.promotionCodeId)
          )
          .where(
            eq(referralInvitationClaims.paymentAttemptId, paymentAttemptId)
          )
          .limit(1);

      return AttemptPromotionCodesRepository.of({
        find: Effect.fn("AttemptPromotionCodesRepository.find")(
          function* (paymentAttemptId) {
            const [[discountCode], [voucherCode], [referral]] =
              yield* Effect.all([
                findDiscountCode(paymentAttemptId),
                findVoucherCode(paymentAttemptId),
                findReferralCode(paymentAttemptId),
              ]);
            const enteredCode = discountCode?.code ?? voucherCode?.code;
            return {
              ...(enteredCode !== undefined && { enteredCode }),
              ...(referral !== undefined && { referralCode: referral.code }),
            };
          }
        ),
      });
    })
  );
}
