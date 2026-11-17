import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import {
  promotionCodes,
  referralCodes,
  type WorkspaceReservationRow,
} from "@/db/schema";
import { makeAccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { testAccountingStorage } from "@/features/accounting/backend/accounting-storage.test-utils";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { calculateDiscounts } from "@/features/discounts/calculator";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import {
  canonicalPromotionCodeSchema,
  promotionCodeIdSchema,
} from "@/features/discounts/persistence-contracts";
import type { DiscountCandidate } from "@/features/discounts/provider";
import { type Locale, m } from "@/features/i18n";
import { referralInvitationDiscountBasisPoints } from "@/features/referrals/program";
import { getReferralBenefitIds } from "@/features/referrals/referral-benefits";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import type { WorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleRepository,
} from "./payment-lifecycle.repository";

const product = { kind: "cowork", tier: "basic" } as const;
const reservationDetails = {
  kind: "cowork",
  entryTier: "basic",
  coffee: false,
} as const;
const locale: Locale = "en-US";

const makeInvitationCandidate = (referral: {
  readonly invitedDotyposCustomerId: DotyposCustomerId;
  readonly referrerDotyposCustomerId: DotyposCustomerId;
  readonly promotionCodeId: string;
}): DiscountCandidate => {
  const promotionCodeId = promotionCodeIdSchema.make(referral.promotionCodeId);
  return {
    discount: {
      id: getReferralBenefitIds(referral.invitedDotyposCustomerId).invitation,
      label: m.checkoutSummaryItemReferralInvitationDiscount({}, { locale }),
      adjustment: {
        kind: "percentage",
        basisPoints: referralInvitationDiscountBasisPoints,
      },
    },
    provenance: {
      providerNamespace: "referral-invitation",
      providerReference: referral.promotionCodeId,
      details: {
        referralInvitation: {
          invitedDotyposCustomerId: referral.invitedDotyposCustomerId,
          referrerDotyposCustomerId: referral.referrerDotyposCustomerId,
          promotionCodeId,
        },
      },
    },
    claim: {
      kind: "referral_invitation",
      invitedDotyposCustomerId: referral.invitedDotyposCustomerId,
      referrerDotyposCustomerId: referral.referrerDotyposCustomerId,
      promotionCodeId,
    },
  };
};

/**
 * Starts a Nexi payment for a held reservation through the real lifecycle
 * admission. With `referral`, the attempt carries a checkout referral: it
 * reserves the invitation claim and records the attribution when paid.
 */
export const admitPendingNexiPayment = (
  repository: IPaymentLifecycleRepository,
  reservation: WorkspaceReservationRow,
  referral?: {
    readonly referrerDotyposCustomerId: DotyposCustomerId;
    readonly promotionCodeId: string;
  }
) =>
  Effect.gen(function* () {
    const dotyposCustomerId =
      reservation.dotyposCustomerId as DotyposCustomerId;
    const baseQuote = yield* buildCoworkReservationQuote(reservationDetails);
    const calculation = referral
      ? yield* calculateDiscounts({
          product,
          discountableSubtotal: baseQuote.payment.expectedPrice,
          candidates: [
            makeInvitationCandidate({
              invitedDotyposCustomerId: dotyposCustomerId,
              ...referral,
            }),
          ],
        })
      : undefined;
    const quote = yield* buildCoworkReservationQuote(
      reservationDetails,
      calculation ? { discountQuote: calculation.quote } : {}
    );
    const snapshot = makeAccountingDocumentSnapshot({
      workspaceReservationId: reservation.id,
      dotyposReservationId: reservation.dotyposReservationId!,
      dotyposCustomerId,
      locale,
      prepared: {
        kind: "cowork",
        reservation: {
          ...reservationDetails,
          date: "2099-01-01",
          name: "Synthetic Customer",
          email: testEmailAddress("synthetic"),
          phone: "+420 700 000 000",
        },
        quote,
      } as PreparedCustomerQuote,
    });
    return yield* repository.createPendingNexiAttempt({
      workspaceReservationId: reservation.id,
      providerOrderId: `order-${crypto.randomUUID()}` as never,
      amount: snapshot.quote.payment.expectedPrice,
      commitment: makeDiscountCommitment({
        product,
        firstServiceDate: "2099-01-01",
        applications: calculation?.applications ?? [],
      }),
      locale,
      accountingSnapshot: snapshot,
    });
  });

const syntheticDotyposCustomerId = () =>
  (
    Math.floor(Math.random() * 900_000_000) + 100_000_000
  ).toString() as DotyposCustomerId;

/**
 * A held reservation of a new invited customer whose unpaid Nexi attempt
 * reserved a referral invitation claim, admitted through the real lifecycle
 * repository on the test database.
 */
export const admitReferralNexiPayment = (
  database: Pick<WorkspacePostgresTestDatabase, "db" | "layer">
) =>
  Effect.gen(function* () {
    const invitedDotyposCustomerId = syntheticDotyposCustomerId();
    const referrerDotyposCustomerId = syntheticDotyposCustomerId();
    const [promotion] = yield* database.db
      .insert(promotionCodes)
      .values({
        kind: "referral",
        code: canonicalPromotionCodeSchema.make(
          `RFL${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`
        ),
        enabled: true,
      })
      .returning({ id: promotionCodes.id });
    yield* database.db.insert(referralCodes).values({
      promotionCodeId: promotion!.id,
      referrerDotyposCustomerId,
    });
    const reservation = yield* workspaceFixtures(database.db).reservation({
      stage: { reservation: "held" },
      customer: invitedDotyposCustomerId,
    });
    const attempt = yield* PaymentLifecycleRepository.use((repository) =>
      admitPendingNexiPayment(repository, reservation, {
        referrerDotyposCustomerId,
        promotionCodeId: promotion!.id,
      })
    ).pipe(
      Effect.provide(
        PaymentLifecycleRepository.Default.pipe(
          Layer.provide(
            Layer.merge(
              database.layer,
              testAccountingStorage(
                database.layer,
                AccountingSnapshotKeyService.Default
              )
            )
          )
        )
      )
    );
    return { attempt, reservation };
  });
