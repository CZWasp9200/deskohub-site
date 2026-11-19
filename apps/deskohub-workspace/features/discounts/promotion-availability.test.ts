import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  evaluatePromotionAvailability,
  getAvailableVoucherCredit,
  type PromotionAvailabilityFacts,
  type PromotionAvailabilityRule,
  type PromotionAvailabilityStage,
  promotionAvailabilityOrder,
  promotionAvailabilityStages,
} from "./promotion-availability";

type Facts = PromotionAvailabilityFacts<PromotionAvailabilityStage>;

const at = Temporal.Instant.from("2026-07-01T10:00:00Z");
const czk = (value: number) => ({ value, exponent: 2, currency: "CZK" });
const date = plainDateStringSchema.make;

/** Facts that meet every rule, each one step away from failing it. */
const available: Facts = {
  at,
  promotion: {
    enabled: true,
    validFrom: at,
    validUntil: at.add({ nanoseconds: 1 }),
  },
  discountCode: {
    maxUses: 5,
    maxUsesPerCustomer: 2,
    serviceDateFrom: date("2026-07-10"),
    serviceDateUntil: date("2026-07-20"),
  },
  firstServiceDate: "2026-07-20",
  audience: { allowlistSize: 2, customerAllowed: true },
  uses: { activeUseCount: 4, customerActiveUseCount: 1 },
  voucher: { amount: czk(1000) },
  voucherUses: { customerHasReserved: false, usedValue: 999 },
};

/** The smallest change to `available` that fails only that rule. */
const failing = {
  enabled: (facts) => ({
    ...facts,
    promotion: { ...facts.promotion, enabled: false },
  }),
  started: (facts) => ({
    ...facts,
    promotion: { ...facts.promotion, validFrom: at.add({ nanoseconds: 1 }) },
  }),
  unexpired: (facts) => ({
    ...facts,
    promotion: { ...facts.promotion, validUntil: at },
  }),
  serviceDates: (facts) => ({ ...facts, firstServiceDate: "2026-07-21" }),
  audience: (facts) => ({
    ...facts,
    audience: { ...facts.audience, customerAllowed: false },
  }),
  totalUses: (facts) => ({
    ...facts,
    uses: { ...facts.uses, activeUseCount: 5 },
  }),
  customerUses: (facts) => ({
    ...facts,
    uses: { ...facts.uses, customerActiveUseCount: 2 },
  }),
  voucherUnclaimed: (facts) => ({
    ...facts,
    voucherUses: { ...facts.voucherUses, customerHasReserved: true },
  }),
  voucherCredit: (facts) => ({
    ...facts,
    voucherUses: { ...facts.voucherUses, usedValue: 1000 },
  }),
} satisfies Record<PromotionAvailabilityRule, (facts: Facts) => Facts>;

const reasons = {
  enabled: "inactive",
  started: "not_started",
  unexpired: "expired",
  serviceDates: "service_date_ineligible",
  audience: "customer_ineligible",
  totalUses: "usage_limit_reached",
  customerUses: "usage_limit_reached",
  voucherUnclaimed: "claim_conflict",
  voucherCredit: "usage_limit_reached",
} satisfies Record<PromotionAvailabilityRule, string>;

const stages = Object.keys(
  promotionAvailabilityStages
) as PromotionAvailabilityStage[];
const allRules = Object.keys(failing) as PromotionAvailabilityRule[];
const stageRules = (stage: PromotionAvailabilityStage) =>
  promotionAvailabilityStages[stage] as readonly PromotionAvailabilityRule[];

/** Evaluates any stage, comparing its outcome with any rule's. */
const evaluate = (
  stage: PromotionAvailabilityStage,
  facts: Facts
): Result.Result<void, unknown> => evaluatePromotionAvailability(stage, facts);

const unavailable = (rule: PromotionAvailabilityRule) =>
  Result.fail({ rule, reason: reasons[rule] });

/** The first stage that checks `rule`. */
const stageChecking = (rule: PromotionAvailabilityRule) => {
  const stage = stages.find((candidate) =>
    stageRules(candidate).includes(rule)
  );
  if (!stage) throw new Error(`No stage checks ${rule}`);
  return stage;
};

/** The stages each caller runs, in the order it runs them. */
const callers = {
  pricingDiscountCode: ["pricingSchedule", "pricingDiscountCode"],
  previewDiscountCode: ["pricingSchedule", "pricingDiscountCodePreview"],
  pricingVoucher: ["pricingSchedule", "pricingVoucher"],
  admissionDiscountCode: [
    "admissionEnabled",
    "admissionDiscountCodeSchedule",
    "admissionAudience",
    "admissionDiscountCodeUses",
  ],
  admissionVoucher: [
    "admissionEnabled",
    "admissionVoucherSchedule",
    "admissionAudience",
    "admissionVoucherUses",
  ],
  readmissionDiscountCode: ["readmissionDiscountCodeUses"],
} satisfies Record<string, readonly PromotionAvailabilityStage[]>;

type Caller = keyof typeof callers;

const callerRules = (caller: Caller) =>
  callers[caller].flatMap((stage) => stageRules(stage));

/** The first stage of `caller` that fails, as the caller reports it. */
const evaluateCaller = (caller: Caller, facts: Facts) =>
  callers[caller]
    .map((stage) => evaluate(stage, facts))
    .find(Result.isFailure) ?? Result.void;

/** Callers of one promotion kind, which must agree on every reason. */
const kinds = {
  "discount code": [
    "pricingDiscountCode",
    "previewDiscountCode",
    "admissionDiscountCode",
    "readmissionDiscountCode",
  ],
  voucher: ["pricingVoucher", "admissionVoucher"],
} satisfies Record<string, readonly Caller[]>;

describe("promotionAvailabilityStages", () => {
  test("pins the shared rule order", () => {
    expect(promotionAvailabilityOrder).toEqual([
      "enabled",
      "started",
      "unexpired",
      "serviceDates",
      "audience",
      "customerUses",
      "totalUses",
      "voucherUnclaimed",
      "voucherCredit",
    ]);
  });

  test("orders every rule exactly once", () => {
    expect([...promotionAvailabilityOrder].sort()).toEqual(
      [...allRules].sort()
    );
  });

  test("pins each stage's rules", () => {
    expect(promotionAvailabilityStages).toEqual({
      pricingSchedule: ["enabled", "started", "unexpired"],
      pricingDiscountCode: [
        "serviceDates",
        "audience",
        "customerUses",
        "totalUses",
      ],
      pricingDiscountCodePreview: ["serviceDates", "totalUses"],
      pricingVoucher: ["audience", "voucherUnclaimed", "voucherCredit"],
      admissionEnabled: ["enabled"],
      admissionDiscountCodeSchedule: ["started", "unexpired", "serviceDates"],
      admissionVoucherSchedule: ["started", "unexpired"],
      admissionAudience: ["audience"],
      admissionDiscountCodeUses: ["customerUses", "totalUses"],
      admissionVoucherUses: ["voucherUnclaimed"],
      readmissionDiscountCodeUses: ["customerUses", "totalUses"],
    });
  });

  test("checks every rule in some stage", () => {
    expect(
      allRules.filter(
        (rule) => !stages.some((stage) => stageRules(stage).includes(rule))
      )
    ).toEqual([]);
  });

  test.each(Object.keys(callers) as Caller[])(
    "%s runs its stages in the shared order",
    (caller) => {
      expect(callerRules(caller)).toEqual(
        promotionAvailabilityOrder.filter((rule) =>
          callerRules(caller).includes(rule)
        )
      );
    }
  );
});

describe("one reason at every caller", () => {
  test.each(
    (Object.keys(callers) as Caller[]).flatMap((caller) =>
      allRules.map((rule) => [caller, rule] as const)
    )
  )(
    "%s rejects a promotion failing only %s exactly when it checks that rule",
    (caller, rule) => {
      expect(evaluateCaller(caller, failing[rule](available))).toEqual(
        callerRules(caller).includes(rule) ? unavailable(rule) : Result.void
      );
    }
  );

  test.each(
    Object.entries(kinds).flatMap(([kind, kindCallers]) =>
      promotionAvailabilityOrder.flatMap((first, index) =>
        promotionAvailabilityOrder
          .slice(index + 1)
          .map((second) => [kind, first, second, kindCallers] as const)
      )
    )
  )(
    "%s callers checking %s and %s all report the first",
    (_kind, first, second, kindCallers) => {
      const facts = failing[second](failing[first](available));
      for (const caller of kindCallers) {
        const rules = callerRules(caller);
        if (rules.includes(first)) {
          expect(evaluateCaller(caller, facts)).toEqual(unavailable(first));
        } else if (rules.includes(second)) {
          expect(evaluateCaller(caller, facts)).toEqual(unavailable(second));
        }
      }
    }
  );

  test.each([
    ["serviceDates", "audience", "pricingDiscountCode"],
    ["serviceDates", "totalUses", "pricingDiscountCode"],
    ["serviceDates", "totalUses", "previewDiscountCode"],
    ["customerUses", "totalUses", "pricingDiscountCode"],
    ["audience", "voucherUnclaimed", "pricingVoucher"],
  ] as const)(
    "a promotion failing %s and %s reports %s's reason at %s as at admission",
    (first, second, caller) => {
      const facts = failing[second](failing[first](available));
      const admission =
        caller === "pricingVoucher"
          ? "admissionVoucher"
          : "admissionDiscountCode";
      expect(evaluateCaller(caller, facts)).toEqual(unavailable(first));
      expect(evaluateCaller(admission, facts)).toEqual(unavailable(first));
    }
  );
});

describe("evaluatePromotionAvailability", () => {
  test.each(stages)("%s admits facts that meet every rule", (stage) => {
    expect(evaluate(stage, available)).toEqual(Result.void);
  });

  test.each(
    stages.flatMap((stage) => allRules.map((rule) => [stage, rule] as const))
  )("%s reports %s only when it checks that rule", (stage, rule) => {
    expect(evaluate(stage, failing[rule](available))).toEqual(
      stageRules(stage).includes(rule) ? unavailable(rule) : Result.void
    );
  });

  test.each(
    stages.flatMap((stage) =>
      stageRules(stage).flatMap((first, index) =>
        stageRules(stage)
          .slice(index + 1)
          .map((second) => [stage, first, second] as const)
      )
    )
  )("%s reports %s before %s", (stage, first, second) => {
    const facts = failing[second](failing[first](available));
    expect(evaluate(stage, facts)).toEqual(unavailable(first));
  });

  describe("boundaries", () => {
    const check = (rule: PromotionAvailabilityRule, facts: Facts) =>
      Result.isSuccess(evaluate(stageChecking(rule), facts));

    test("the validity window includes its start and excludes its end", () => {
      const window = (
        validFrom: Temporal.Instant | null,
        validUntil: Temporal.Instant | null
      ): Facts => ({
        ...available,
        promotion: { enabled: true, validFrom, validUntil },
      });
      const later = at.add({ nanoseconds: 1 });
      const earlier = at.subtract({ nanoseconds: 1 });

      expect(check("started", window(at, null))).toBe(true);
      expect(check("started", window(later, null))).toBe(false);
      expect(check("started", window(null, null))).toBe(true);
      expect(check("unexpired", window(null, later))).toBe(true);
      expect(check("unexpired", window(null, at))).toBe(false);
      expect(check("unexpired", window(null, earlier))).toBe(false);
      expect(check("unexpired", window(null, null))).toBe(true);
    });

    test("service dates include both ends and an absent window covers every date", () => {
      const starting = (
        firstServiceDate: string,
        serviceDateFrom: string | null,
        serviceDateUntil: string | null
      ): Facts => ({
        ...available,
        firstServiceDate,
        discountCode: {
          ...available.discountCode,
          serviceDateFrom:
            serviceDateFrom === null ? null : date(serviceDateFrom),
          serviceDateUntil:
            serviceDateUntil === null ? null : date(serviceDateUntil),
        },
      });

      expect(
        check(
          "serviceDates",
          starting("2026-07-10", "2026-07-10", "2026-07-20")
        )
      ).toBe(true);
      expect(
        check(
          "serviceDates",
          starting("2026-07-20", "2026-07-10", "2026-07-20")
        )
      ).toBe(true);
      expect(
        check(
          "serviceDates",
          starting("2026-07-09", "2026-07-10", "2026-07-20")
        )
      ).toBe(false);
      expect(
        check(
          "serviceDates",
          starting("2026-07-21", "2026-07-10", "2026-07-20")
        )
      ).toBe(false);
      expect(check("serviceDates", starting("2099-12-31", null, null))).toBe(
        true
      );
      expect(
        check("serviceDates", starting("2026-07-15", "2026-07-10", null))
      ).toBe(false);
    });

    test("an empty allowlist admits everyone and a non-empty one only its customers", () => {
      const audience = (allowlistSize: number, customerAllowed: boolean) => ({
        ...available,
        audience: { allowlistSize, customerAllowed },
      });

      expect(check("audience", audience(0, false))).toBe(true);
      expect(check("audience", audience(1, true))).toBe(true);
      expect(check("audience", audience(1, false))).toBe(false);
    });

    test("use limits admit counts below the limit, and no limit admits any count", () => {
      const uses = (
        maxUses: number | null,
        maxUsesPerCustomer: number | null,
        activeUseCount: number,
        customerActiveUseCount: number
      ): Facts => ({
        ...available,
        discountCode: {
          ...available.discountCode,
          maxUses,
          maxUsesPerCustomer,
        },
        uses: { activeUseCount, customerActiveUseCount },
      });

      expect(check("totalUses", uses(3, null, 2, 0))).toBe(true);
      expect(check("totalUses", uses(3, null, 3, 0))).toBe(false);
      expect(check("totalUses", uses(0, null, 0, 0))).toBe(false);
      expect(check("totalUses", uses(null, null, 10_000, 10_000))).toBe(true);
      expect(check("customerUses", uses(null, 1, 5, 0))).toBe(true);
      expect(check("customerUses", uses(null, 1, 5, 1))).toBe(false);
      expect(check("customerUses", uses(null, 0, 0, 0))).toBe(false);
      expect(check("customerUses", uses(null, null, 10_000, 10_000))).toBe(
        true
      );
    });

    test("a voucher stays available while any credit remains", () => {
      const used = (usedValue: number): Facts => ({
        ...available,
        voucherUses: { customerHasReserved: false, usedValue },
      });

      expect(check("voucherCredit", used(0))).toBe(true);
      expect(check("voucherCredit", used(999))).toBe(true);
      expect(check("voucherCredit", used(1000))).toBe(false);
      expect(check("voucherCredit", used(1001))).toBe(false);
    });
  });
});

describe("getAvailableVoucherCredit", () => {
  test("keeps the voucher's unit and subtracts the used value", () => {
    expect(getAvailableVoucherCredit(czk(1000), 250)).toEqual(czk(750));
    expect(getAvailableVoucherCredit(czk(1000), 1200)).toEqual(czk(-200));
  });
});
