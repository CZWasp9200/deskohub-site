import { Schema } from "effect";
import { audienceFilterSchema } from "../../audience-filter";
import { campaignAudienceIdSchema } from "../../campaign-identifiers";

const audienceTitleSchema = Schema.Trim.check(
  Schema.isNonEmpty({ message: "Enter a title for this audience." }),
  Schema.isMaxLength(120, { message: "Use at most 120 characters." })
);

/** What the audience editor validates before it saves. */
export const audienceFormSchema = Schema.Struct({
  title: audienceTitleSchema,
  filter: audienceFilterSchema,
});
export type AudienceFormValues = typeof audienceFormSchema.Encoded;

const parseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

/** Creates an audience, or replaces an existing one's title and filter. */
export const saveAudienceStandardSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    audienceId: Schema.optionalKey(campaignAudienceIdSchema),
    title: audienceTitleSchema,
    filter: audienceFilterSchema,
  }),
  { parseOptions }
);

export const audienceReferenceStandardSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ audienceId: campaignAudienceIdSchema }),
  { parseOptions }
);
