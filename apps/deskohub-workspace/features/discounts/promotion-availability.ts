import { Result, type Types } from "effect";
import { type Money, moneyWithValue } from "@/shared/money/money";
import {
  isFirstServiceDateEligible,
  type ServiceDateWindow,
} from "./service-date-eligibility";

/**
 * When a submitted discount code or voucher may be used: the availability
 * rules pricing checks before it offers a promotion and claim admission
 * checks again before it reserves a claim. Callers load the facts; admission
 * reads them under its promotion row lock.
 */
const promotionAvailabilityRules = {
  enabled: {
    reason: "inactive",
    isMet: (facts: { readonly promotion: { readonly enabled: boolean } }) =>
      facts.promotion.enabled,
  },
  started: {
    reason: "not_started",
    isMet: (facts: {
      readonly at: Temporal.Instant;
      readonly promotion: { readonly validFrom: Temporal.Instant | null };
    }) =>
      facts.promotion.validFrom === null ||
      Temporal.Instant.compare(facts.at, facts.promotion.validFrom) >= 0,
  },
  unexpired: {
    reason: "expired",
    isMet: (facts: {
      readonly at: Temporal.Instant;
      readonly promotion: { readonly validUntil: Temporal.Instant | null };
    }) =>
      facts.promotion.validUntil === null ||
      Temporal.Instant.compare(facts.at, facts.promotion.validUntil) < 0,
  },
  serviceDates: {
    reason: "service_date_ineligible",
    isMet: (facts: {
      readonly discountCode: ServiceDateWindow;
      readonly firstServiceDate: string;
    }) =>
      isFirstServiceDateEligible(facts.discountCode, facts.firstServiceDate),
  },
  audience: {
    reason: "customer_ineligible",
    isMet: (facts: {
      readonly audience: {
        readonly allowlistSize: number;
        readonly customerAllowed: boolean;
      };
    }) =>
      !(facts.audience.allowlistSize > 0 && !facts.audience.customerAllowed),
  },
  totalUses: {
    reason: "usage_limit_reached",
    isMet: (facts: {
      readonly discountCode: { readonly maxUses: number | null };
      readonly uses: { readonly activeUseCount: number };
    }) =>
      facts.discountCode.maxUses === null ||
      facts.uses.activeUseCount < facts.discountCode.maxUses,
  },
  customerUses: {
    reason: "usage_limit_reached",
    isMet: (facts: {
      readonly discountCode: { readonly maxUsesPerCustomer: number | null };
      readonly uses: { readonly customerActiveUseCount: number };
    }) =>
      facts.discountCode.maxUsesPerCustomer === null ||
      facts.uses.customerActiveUseCount < facts.discountCode.maxUsesPerCustomer,
  },
  voucherUnclaimed: {
    reason: "claim_conflict",
    isMet: (facts: {
      readonly voucherUses: { readonly customerHasReserved: boolean };
    }) => !facts.voucherUses.customerHasReserved,
  },
  voucherCredit: {
    reason: "usage_limit_reached",
    isMet: (facts: {
      readonly voucher: { readonly amount: Money };
      readonly voucherUses: { readonly usedValue: number };
    }) =>
      getAvailableVoucherCredit(
        facts.voucher.amount,
        facts.voucherUses.usedValue
      ).value > 0,
  },
} as const;

type Rules = typeof promotionAvailabilityRules;

export type PromotionAvailabilityRule = keyof Rules;

/**
 * The one order every caller checks the rules in. It decides which reason
 * wins when several rules fail, so pricing, preview and claim admission
 * report the same reason for the same promotion. It follows admission, whose
 * row locks and reads split it into stages; every caller runs its stages in
 * this order.
 */
export const promotionAvailabilityOrder = [
  "enabled",
  "started",
  "unexpired",
  "serviceDates",
  "audience",
  "customerUses",
  "totalUses",
  "voucherUnclaimed",
  "voucherCredit",
] as const satisfies readonly PromotionAvailabilityRule[];

/** The given rules, in the shared order. */
const inPromotionAvailabilityOrder = <
  const Rule extends PromotionAvailabilityRule,
>(
  rules: readonly Rule[]
): readonly Rule[] =>
  promotionAvailabilityOrder.filter((rule): rule is Rule =>
    (rules as readonly PromotionAvailabilityRule[]).includes(rule)
  );

/** The rules each caller checks at each step, in the shared order. */
export const promotionAvailabilityStages = {
  /** Pricing and preview, before usage facts load, for both kinds. */
  pricingSchedule: inPromotionAvailabilityOrder([
    "enabled",
    "started",
    "unexpired",
  ]),
  pricingDiscountCode: inPromotionAvailabilityOrder([
    "serviceDates",
    "audience",
    "customerUses",
    "totalUses",
  ]),
  /** Preview has no customer, so no audience or per-customer use. */
  pricingDiscountCodePreview: inPromotionAvailabilityOrder([
    "serviceDates",
    "totalUses",
  ]),
  pricingVoucher: inPromotionAvailabilityOrder([
    "audience",
    "voucherUnclaimed",
    "voucherCredit",
  ]),
  /** Admission, under the promotion row lock, before the hold check. */
  admissionEnabled: inPromotionAvailabilityOrder(["enabled"]),
  /** Admission, after the hold check, before the allowlist is read. */
  admissionDiscountCodeSchedule: inPromotionAvailabilityOrder([
    "started",
    "unexpired",
    "serviceDates",
  ]),
  admissionVoucherSchedule: inPromotionAvailabilityOrder([
    "started",
    "unexpired",
  ]),
  /** Admission, before the accepted benefit check, for both kinds. */
  admissionAudience: inPromotionAvailabilityOrder(["audience"]),
  /** Admission, after the accepted benefit check. */
  admissionDiscountCodeUses: inPromotionAvailabilityOrder([
    "customerUses",
    "totalUses",
  ]),
  admissionVoucherUses: inPromotionAvailabilityOrder(["voucherUnclaimed"]),
  /** Late recovery redeeming a released discount-code claim again. */
  readmissionDiscountCodeUses: inPromotionAvailabilityOrder([
    "customerUses",
    "totalUses",
  ]),
};

export type PromotionAvailabilityStage =
  keyof typeof promotionAvailabilityStages;

type StageRule<Stage extends PromotionAvailabilityStage> =
  (typeof promotionAvailabilityStages)[Stage][number];

/** Every fact the rules of `Stage` read. */
export type PromotionAvailabilityFacts<
  Stage extends PromotionAvailabilityStage,
> = Types.UnionToIntersection<Parameters<Rules[StageRule<Stage>]["isMet"]>[0]>;

/** The first rule of a stage that the facts fail, and its reason. */
export type PromotionUnavailable<
  Stage extends PromotionAvailabilityStage = PromotionAvailabilityStage,
> = {
  readonly [Rule in StageRule<Stage>]: {
    readonly rule: Rule;
    readonly reason: Rules[Rule]["reason"];
  };
}[StageRule<Stage>];

/**
 * Checks the rules of one caller's stage in the shared order and returns
 * the first that fails. Reads no clock: `at` is a fact.
 */
export const evaluatePromotionAvailability = <
  Stage extends PromotionAvailabilityStage,
>(
  stage: Stage,
  facts: PromotionAvailabilityFacts<Stage>
): Result.Result<void, PromotionUnavailable<Stage>> => {
  const rules: readonly PromotionAvailabilityRule[] =
    promotionAvailabilityStages[stage];
  const failed = rules.find(
    (rule) =>
      !(
        promotionAvailabilityRules[rule].isMet as (
          facts: PromotionAvailabilityFacts<Stage>
        ) => boolean
      )(facts)
  );
  return failed === undefined
    ? Result.void
    : Result.fail({
        rule: failed,
        reason: promotionAvailabilityRules[failed].reason,
      } as PromotionUnavailable<Stage>);
};

/** The credit a voucher still grants after its active claims' amounts. */
export const getAvailableVoucherCredit = (
  amount: Money,
  usedValue: number
): Money => moneyWithValue(amount.value - usedValue, amount);
