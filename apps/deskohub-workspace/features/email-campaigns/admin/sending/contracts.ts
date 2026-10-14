import { Schema } from "effect";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { campaignIdSchema } from "../../campaign-identifiers";

const standardSchemaOptions = {
  parseOptions: { errors: "all", onExcessProperty: "error" },
} as const;

const campaignTestSendSchema = Schema.Struct({
  campaignId: campaignIdSchema,
  extraRecipients: Schema.Array(reservationCustomerEmailSchema),
});

export const campaignTestSendStandardSchema = Schema.toStandardSchemaV1(
  campaignTestSendSchema,
  standardSchemaOptions
);

const campaignSendSchema = Schema.Struct({
  campaignId: campaignIdSchema,
  confirmationCode: Schema.Trimmed.check(Schema.isNonEmpty()),
});

export const campaignSendStandardSchema = Schema.toStandardSchemaV1(
  campaignSendSchema,
  standardSchemaOptions
);

const campaignReferenceSchema = Schema.Struct({
  campaignId: campaignIdSchema,
});

export const campaignReferenceStandardSchema = Schema.toStandardSchemaV1(
  campaignReferenceSchema,
  standardSchemaOptions
);

/** One extra test-send address as typed into the dialog. */
export const testRecipientFieldSchema = Schema.Struct({
  email: reservationCustomerEmailSchema,
});

/**
 * The confirmation code as typed: 8 letters or digits in any case, with an
 * optional hyphen in the middle. The send service normalizes it.
 */
export const confirmationCodeFieldSchema = Schema.Struct({
  code: Schema.Trim.check(
    Schema.isPattern(/^[a-z0-9]{4}-?[a-z0-9]{4}$/i, {
      message: "Enter the 8-character code from the latest test email.",
    })
  ),
});
