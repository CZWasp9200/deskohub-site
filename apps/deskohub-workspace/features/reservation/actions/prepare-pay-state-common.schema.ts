import { Schema } from "effect";
import {
  checkoutAttemptIdSchema,
  checkoutSessionIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { locales } from "@/features/i18n";

export const preparePayStateCommonSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  checkoutSessionId: checkoutSessionIdSchema,
  checkoutAttemptId: checkoutAttemptIdSchema,
  advertisedPriceToken: Schema.NonEmptyString,
  marketingConsent: Schema.optional(Schema.Boolean),
  /** Books as the signed-in account's own contact and Dotypos customer. */
  customer: Schema.optional(Schema.Literal("account")),
  /**
   * A shared referral code from the reservation URL. Only an account booking
   * may accept it, and an unusable code never blocks checkout.
   */
  referralCode: Schema.optional(Schema.String),
});
