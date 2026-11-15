import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  discountApplications,
  discountCodeRedemptions,
  promotionCodeCustomers,
  voucherRedemptions,
} from "@/db/schema";
import type {
  DiscountCodeId,
  PromotionCodeId,
  VoucherId,
} from "./persistence-contracts";

const buildPromotionAudienceQuery = (input: {
  readonly db: WorkspaceDatabaseClient;
  readonly promotionCodeId: PromotionCodeId;
  readonly dotyposCustomerId: DotyposCustomerId;
}) =>
  input.db
    .select({
      allowlistSize: count(),
      customerAllowed: sql<boolean>`coalesce(bool_or(${promotionCodeCustomers.dotyposCustomerId} = ${input.dotyposCustomerId}), false)`,
    })
    .from(promotionCodeCustomers)
    .where(eq(promotionCodeCustomers.promotionCodeId, input.promotionCodeId));

const buildDiscountCodeAvailabilityQuery = (input: {
  readonly db: WorkspaceDatabaseClient;
  readonly codeId: DiscountCodeId;
  readonly dotyposCustomerId: DotyposCustomerId;
}) =>
  input.db
    .select({
      activeUseCount: count(),
      customerActiveUseCount: sql<number>`count(*) filter (where ${discountCodeRedemptions.dotyposCustomerId} = ${input.dotyposCustomerId})::integer`,
    })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, input.codeId),
        inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
      )
    );

export const buildDiscountCodePreviewAvailabilityQuery = (input: {
  readonly db: WorkspaceDatabaseClient;
  readonly codeId: DiscountCodeId;
}) =>
  input.db
    .select({ activeUseCount: count() })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, input.codeId),
        inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
      )
    );

const buildVoucherAvailabilityQuery = (input: {
  readonly db: WorkspaceDatabaseClient;
  readonly voucherId: VoucherId;
  readonly dotyposCustomerId: DotyposCustomerId;
}) =>
  input.db
    .select({
      customerHasReserved: sql<boolean>`coalesce(bool_or(${voucherRedemptions.dotyposCustomerId} = ${input.dotyposCustomerId} and ${voucherRedemptions.state} = 'reserved'), false)`,
      usedValue: sql<number>`coalesce(sum(${discountApplications.appliedAmountValue}), 0)::integer`,
    })
    .from(voucherRedemptions)
    .innerJoin(
      discountApplications,
      eq(discountApplications.id, voucherRedemptions.applicationId)
    )
    .where(
      and(
        eq(voucherRedemptions.voucherId, input.voucherId),
        inArray(voucherRedemptions.state, ["reserved", "redeemed"])
      )
    );

/** The promotion's allowlist size and whether it names the customer. */
export const readPromotionAudience = (
  input: Parameters<typeof buildPromotionAudienceQuery>[0]
) =>
  Effect.map(buildPromotionAudienceQuery(input), ([row]) => ({
    allowlistSize: row?.allowlistSize ?? 0,
    customerAllowed: row?.customerAllowed ?? false,
  }));

/** A discount code's active uses in total and by the customer. */
export const readDiscountCodeUses = (
  input: Parameters<typeof buildDiscountCodeAvailabilityQuery>[0]
) =>
  Effect.map(buildDiscountCodeAvailabilityQuery(input), ([row]) => ({
    activeUseCount: row?.activeUseCount ?? 0,
    customerActiveUseCount: row?.customerActiveUseCount ?? 0,
  }));

/** A voucher's credit used by active claims, and the customer's reserved claim. */
export const readVoucherUses = (
  input: Parameters<typeof buildVoucherAvailabilityQuery>[0]
) =>
  Effect.map(buildVoucherAvailabilityQuery(input), ([row]) => ({
    customerHasReserved: row?.customerHasReserved ?? false,
    usedValue: row?.usedValue ?? 0,
  }));
