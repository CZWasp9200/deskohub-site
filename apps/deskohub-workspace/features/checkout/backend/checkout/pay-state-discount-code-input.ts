import { Schema } from "effect";
import { locales } from "@/features/i18n";

/** The Pay state a discount-code change is made on. */
const payStateFields = {
  locale: Schema.Literals(locales),
  payStateToken: Schema.NonEmptyString,
};

const applyDiscountCodeInputSchema = Schema.Struct({
  ...payStateFields,
  submittedCode: Schema.String,
});

export const applyDiscountCodeSchema = Schema.toStandardSchemaV1(
  applyDiscountCodeInputSchema
);

export type ApplyDiscountCodeInput = typeof applyDiscountCodeInputSchema.Type;

const clearDiscountCodeInputSchema = Schema.Struct(payStateFields);

export const clearDiscountCodeSchema = Schema.toStandardSchemaV1(
  clearDiscountCodeInputSchema
);

export type ClearDiscountCodeInput = typeof clearDiscountCodeInputSchema.Type;
