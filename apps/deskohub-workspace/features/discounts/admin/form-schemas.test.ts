import { describe, expect, test } from "bun:test";
import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import type { Schema } from "effect";
import type { FieldValues } from "react-hook-form";
import {
  customerCodeAudienceFormSchema,
  type DiscountCodeCreationFormValues,
  type DiscountCodeFormValues,
  type DiscountDefinitionFormValues,
  discountCodeCreationFormSchema,
  discountCodeFormSchema,
  discountDefinitionFormSchema,
  type VoucherFormValues,
  voucherFormSchema,
} from "./form-schemas";

// Resolves through the same resolver the administration forms use, so each
// failing field is one that would render its message beside that input.
const failingFields = async <Values extends FieldValues>(
  schema: Schema.Codec<unknown, Values>,
  values: Values
) => {
  const { errors } = await effectSchemaResolver(schema)(values, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  });
  return Object.keys(errors).sort();
};

const discountDefinition = (
  overrides: Partial<DiscountDefinitionFormValues> = {}
): DiscountDefinitionFormValues => ({
  labelEn: "Summer discount",
  labelCs: "Letní sleva",
  adjustmentKind: "percentage",
  percentage: "10",
  fixedAmountValue: "10000",
  fixedAmountCurrency: "CZK",
  products: [],
  ...overrides,
});

const codeConfiguration = {
  code: "SUMMER10",
  enabled: true,
  validFrom: "",
  validUntil: "",
  maxUses: "",
  maxUsesPerCustomer: "",
};

const discountCode = (
  overrides: Partial<DiscountCodeFormValues> = {}
): DiscountCodeFormValues => ({
  discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
  ...codeConfiguration,
  ...overrides,
});

const voucher = (
  overrides: Partial<VoucherFormValues> = {}
): VoucherFormValues => ({
  voucherValue: "10000",
  voucherCurrency: "CZK",
  code: "GIFT100",
  enabled: true,
  validFrom: "",
  validUntil: "",
  ...overrides,
});

const discountCodeCreation = (
  overrides: Partial<DiscountCodeCreationFormValues> = {}
): DiscountCodeCreationFormValues => ({
  discountKind: "existing",
  discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
  ...discountDefinition(),
  ...codeConfiguration,
  ...overrides,
});

describe("discount definition form schema", () => {
  test("accepts a complete percentage definition", async () => {
    expect(
      await failingFields(discountDefinitionFormSchema, discountDefinition())
    ).toEqual([]);
  });

  test("reports every missing label at once", async () => {
    expect(
      await failingFields(
        discountDefinitionFormSchema,
        discountDefinition({ labelEn: " ", labelCs: "" })
      )
    ).toEqual(["labelCs", "labelEn"]);
  });

  test.each([
    ["", false],
    ["0", false],
    ["0.009", false],
    ["0.01", true],
    ["100", true],
    ["100.01", false],
    ["ten", false],
  ])(
    "accepts percentage %p only within 0.01 to 100: %p",
    async (percentage, accepted) => {
      expect(
        await failingFields(
          discountDefinitionFormSchema,
          discountDefinition({ percentage })
        )
      ).toEqual(accepted ? [] : ["percentage"]);
    }
  );

  test.each([
    ["", false],
    ["0", false],
    ["1", true],
    ["1.5", false],
    ["9007199254740992", false],
  ])(
    "accepts fixed minor units %p only as a whole number of at least 1: %p",
    async (fixedAmountValue, accepted) => {
      expect(
        await failingFields(
          discountDefinitionFormSchema,
          discountDefinition({ adjustmentKind: "fixed", fixedAmountValue })
        )
      ).toEqual(accepted ? [] : ["fixedAmountValue"]);
    }
  );

  test("requires a currency for a fixed adjustment", async () => {
    expect(
      await failingFields(
        discountDefinitionFormSchema,
        discountDefinition({ adjustmentKind: "fixed", fixedAmountCurrency: "" })
      )
    ).toEqual(["fixedAmountCurrency"]);
  });

  test.each([
    [["cowork"], true],
    [["cowork:open-space"], true],
    [["cowork:open-space", "cowork:reserved-desk", "office"], true],
    [["cowork", "cowork:reserved-desk"], false],
    [["cowork:open-space", "meeting-room", "cowork"], false],
  ] as const)(
    "accepts product keys %p only without broad cowork beside a tier: %p",
    async (products, accepted) => {
      expect(
        await failingFields(
          discountDefinitionFormSchema,
          discountDefinition({ products })
        )
      ).toEqual(accepted ? [] : ["products"]);
    }
  );

  test("explains an incoherent cowork selection", async () => {
    const { errors } = await effectSchemaResolver(discountDefinitionFormSchema)(
      discountDefinition({ products: ["cowork", "cowork:open-space"] }),
      undefined,
      { fields: {}, shouldUseNativeValidation: false }
    );
    expect(errors.products?.message).toBe(
      "Choose either all cowork tiers or specific cowork tiers, not both."
    );
  });

  test("checks only the active adjustment kind", async () => {
    const inactiveFixed = { fixedAmountValue: "", fixedAmountCurrency: "" };
    expect(
      await failingFields(
        discountDefinitionFormSchema,
        discountDefinition(inactiveFixed)
      )
    ).toEqual([]);
    expect(
      await failingFields(
        discountDefinitionFormSchema,
        discountDefinition({ adjustmentKind: "fixed", percentage: "" })
      )
    ).toEqual([]);
  });
});

describe("discount code form schema", () => {
  test.each([
    ["", false],
    ["AB", false],
    [" AB ", false],
    ["ABC", true],
    ["A".repeat(64), true],
    ["A".repeat(65), false],
  ])(
    "accepts code %p only with 3 to 64 trimmed characters: %p",
    async (code, accepted) => {
      expect(
        await failingFields(discountCodeFormSchema, discountCode({ code }))
      ).toEqual(accepted ? [] : ["code"]);
    }
  );

  test("requires a discount", async () => {
    expect(
      await failingFields(
        discountCodeFormSchema,
        discountCode({ discountId: "" })
      )
    ).toEqual(["discountId"]);
  });

  test.each([
    ["", true],
    ["2026-08-01T08:00", true],
    ["2026-08-01T08:00:30", true],
    ["2026-08-01", false],
  ])(
    "accepts validity bound %p only as an optional local date and time: %p",
    async (bound, accepted) => {
      expect(
        await failingFields(
          discountCodeFormSchema,
          discountCode({ validFrom: bound, validUntil: bound })
        )
      ).toEqual(accepted ? [] : ["validFrom", "validUntil"]);
    }
  );

  test.each([
    ["", true],
    ["1", true],
    ["0", false],
    ["1.5", false],
  ])(
    "accepts use limit %p only as an optional whole number of at least 1: %p",
    async (limit, accepted) => {
      expect(
        await failingFields(
          discountCodeFormSchema,
          discountCode({ maxUses: limit, maxUsesPerCustomer: limit })
        )
      ).toEqual(accepted ? [] : ["maxUses", "maxUsesPerCustomer"]);
    }
  );
});

describe("voucher form schema", () => {
  test("accepts complete voucher credit", async () => {
    expect(await failingFields(voucherFormSchema, voucher())).toEqual([]);
  });

  test.each(["", "0", "1.5"])(
    "rejects voucher value %p",
    async (voucherValue) => {
      expect(
        await failingFields(voucherFormSchema, voucher({ voucherValue }))
      ).toEqual(["voucherValue"]);
    }
  );

  test("requires a currency and a valid code", async () => {
    expect(
      await failingFields(
        voucherFormSchema,
        voucher({ voucherCurrency: "", code: "AB" })
      )
    ).toEqual(["code", "voucherCurrency"]);
  });
});

describe("discount code creation form schema", () => {
  test("requires a chosen discount on the existing-discount branch", async () => {
    expect(
      await failingFields(
        discountCodeCreationFormSchema,
        discountCodeCreation({ discountId: " " })
      )
    ).toEqual(["discountId"]);
  });

  test("skips new-discount definition checks on the existing-discount branch", async () => {
    expect(
      await failingFields(
        discountCodeCreationFormSchema,
        discountCodeCreation({ labelEn: "", labelCs: "", percentage: "" })
      )
    ).toEqual([]);
  });

  test("checks the new definition instead of the discount choice on the new-discount branch", async () => {
    expect(
      await failingFields(
        discountCodeCreationFormSchema,
        discountCodeCreation({
          discountKind: "new",
          discountId: "",
          labelEn: "",
          labelCs: "",
          percentage: "200",
        })
      )
    ).toEqual(["labelCs", "labelEn", "percentage"]);
    expect(
      await failingFields(
        discountCodeCreationFormSchema,
        discountCodeCreation({ discountKind: "new", discountId: "" })
      )
    ).toEqual([]);
  });

  test("checks the cowork selection only on the new-discount branch", async () => {
    const products = ["cowork", "cowork:reserved-desk"] as const;
    expect(
      await failingFields(
        discountCodeCreationFormSchema,
        discountCodeCreation({ products })
      )
    ).toEqual([]);
    expect(
      await failingFields(
        discountCodeCreationFormSchema,
        discountCodeCreation({ discountKind: "new", products })
      )
    ).toEqual(["products"]);
  });
});

describe("customer code audience form schema", () => {
  test("requires a Dotypos customer ID", async () => {
    expect(
      await failingFields(customerCodeAudienceFormSchema, { customerId: "" })
    ).toEqual(["customerId"]);
    expect(
      await failingFields(customerCodeAudienceFormSchema, {
        customerId: "42",
      })
    ).toEqual([]);
  });
});
