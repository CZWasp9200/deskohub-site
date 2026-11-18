import * as Data from "effect/Data";
import * as Schema from "effect/Schema";
import { CloudinaryPublicIdSchema } from "./schema";

export class CloudinaryConfigError extends Schema.TaggedError<CloudinaryConfigError>()(
  "CloudinaryConfigError",
  {
    message: Schema.String,
  }
) {}

export class CloudinarySearchError extends Schema.TaggedError<CloudinarySearchError>()(
  "CloudinarySearchError",
  {
    message: Schema.String,
    expression: Schema.String,
    httpCode: Schema.optional(Schema.Finite),
  }
) {}

export class CloudinaryUploadError extends Schema.TaggedError<CloudinaryUploadError>()(
  "CloudinaryUploadError",
  {
    message: Schema.String,
    publicId: CloudinaryPublicIdSchema,
    httpCode: Schema.optional(Schema.Finite),
  }
) {}

export class CloudinaryDestroyError extends Schema.TaggedError<CloudinaryDestroyError>()(
  "CloudinaryDestroyError",
  {
    message: Schema.String,
    publicId: CloudinaryPublicIdSchema,
    outcome: Schema.Literals(["uncertain", "failed"]),
    httpCode: Schema.optional(Schema.Finite),
  }
) {}

export class CloudinaryPrefixDeleteError extends Schema.TaggedError<CloudinaryPrefixDeleteError>()(
  "CloudinaryPrefixDeleteError",
  {
    message: Schema.String,
    outcome: Schema.Literals(["uncertain", "failed"]),
    httpCode: Schema.optional(Schema.Finite),
  }
) {}

export class CloudinaryRenameError extends Schema.TaggedError<CloudinaryRenameError>()(
  "CloudinaryRenameError",
  {
    message: Schema.String,
    fromPublicId: CloudinaryPublicIdSchema,
    toPublicId: CloudinaryPublicIdSchema,
    reason: Schema.Literals(["target-exists", "source-missing", "failed"]),
    httpCode: Schema.optional(Schema.Finite),
  }
) {}

export class CloudinaryWebhookAuthError extends Data.TaggedError(
  "CloudinaryWebhookAuthError"
)<{ readonly message: string }> {}

export class CloudinaryWebhookValidationError extends Data.TaggedError(
  "CloudinaryWebhookValidationError"
)<{
  readonly message: string;
  readonly payload?: string;
  readonly cause?: unknown;
}> {}
