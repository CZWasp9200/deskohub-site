"use server";

import { CloudinaryPublicIdSchema } from "@deskohub/cloudinary";
import { CloudinaryService } from "@deskohub/cloudinary/server";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Schema } from "effect";
import { env } from "@/env";
import { WorkspaceCloudinaryLayer } from "@/features/gallery/backend/cloudinary.service";
import { requireAdministratorAuthorization } from "@/shared/administrator/administrator-authorization.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

const campaignImageMaxBytes = 5 * 1024 * 1024;

const campaignImageMediaTypes: ReadonlySet<string> = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const imageUploadIssue = (message: string): StandardSchemaV1.Issue => ({
  message,
});

const campaignImageUploadSchema: StandardSchemaV1<
  unknown,
  { readonly file: File }
> = {
  "~standard": {
    version: 1,
    vendor: "deskohub",
    validate: (value) => {
      const file = value instanceof FormData ? value.get("file") : null;
      if (!(file instanceof File) || file.size === 0) {
        return { issues: [imageUploadIssue("Choose an image to upload.")] };
      }
      if (!campaignImageMediaTypes.has(file.type)) {
        return {
          issues: [imageUploadIssue("Upload a PNG, JPEG, GIF, or WebP image.")],
        };
      }
      if (file.size > campaignImageMaxBytes) {
        return {
          issues: [imageUploadIssue("The image must be 5 MB or smaller.")],
        };
      }
      return { value: { file } };
    },
  },
};

const uploadCampaignBodyImage = Effect.fn("CampaignComposer.uploadImage")(
  function* (file: File) {
    const cloudinary = yield* CloudinaryService;
    const bytes = yield* Effect.promise(() => file.arrayBuffer());
    const publicId = yield* Schema.decodeEffect(CloudinaryPublicIdSchema)(
      crypto.randomUUID()
    );
    const asset = yield* cloudinary.uploadImage({
      bytes: new Uint8Array(bytes),
      publicId,
      folder: `email-campaigns/${env.VERCEL_ENV}`,
    });
    return { url: asset.secure_url };
  }
);

const uploadCampaignImageAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.upload-image",
    schema: campaignImageUploadSchema,
    logInput: false,
  },
  ({ file }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(uploadCampaignBodyImage(file)),
      Effect.provide(WorkspaceCloudinaryLayer),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: "The image could not be uploaded. Try again.",
            cause,
          })
      )
    )
);

/** Uploads a body image to the Deskohub Cloudinary account. */
export const uploadCampaignImage: typeof uploadCampaignImageAction = async (
  ...args: Parameters<typeof uploadCampaignImageAction>
) => {
  "use server";
  return await uploadCampaignImageAction(...args);
};
