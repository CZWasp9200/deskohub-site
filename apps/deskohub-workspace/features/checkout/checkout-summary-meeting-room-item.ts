import { Schema } from "effect";
import {
  checkoutSummaryDiscountSchema,
  checkoutSummaryProductItemBaseSchema,
  checkoutSummaryProductKeyFilter,
} from "@/features/checkout/checkout-summary-product-item";
import { workspaceMeetingRoomProductIdentitySchema } from "@/features/reservation/meeting-room-reservation";
import {
  nonNegativeMoneyCodec,
  positiveMoneyCodec,
} from "@/shared/money/money";
import { instantStringSchema } from "@/shared/utils/temporal";

const meetingRoomCheckoutSummaryProductItemBaseSchema = Schema.Struct({
  ...checkoutSummaryProductItemBaseSchema.fields,
  product: workspaceMeetingRoomProductIdentitySchema,
  /**
   * The customer comes early to set up: when they may come in, and its
   * price, which is nothing.
   */
  earlySetup: Schema.optionalKey(
    Schema.Struct({
      startsAt: instantStringSchema,
      amount: nonNegativeMoneyCodec,
    })
  ),
});

export const meetingRoomCheckoutSummaryProductItemSchema = Schema.Struct({
  ...meetingRoomCheckoutSummaryProductItemBaseSchema.fields,
  originalAmount: Schema.optionalKey(Schema.Never),
  discounts: Schema.optionalKey(Schema.Never),
}).check(checkoutSummaryProductKeyFilter);

export const meetingRoomCheckoutSummaryDiscountedProductItemSchema =
  Schema.Struct({
    ...meetingRoomCheckoutSummaryProductItemBaseSchema.fields,
    originalAmount: positiveMoneyCodec,
    discounts: Schema.NonEmptyArray(checkoutSummaryDiscountSchema),
  }).check(checkoutSummaryProductKeyFilter);
