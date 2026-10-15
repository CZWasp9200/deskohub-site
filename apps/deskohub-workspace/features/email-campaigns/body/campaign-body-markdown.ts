import { MarkdownManager } from "@tiptap/markdown";
import { Effect, Schema } from "effect";
import {
  CampaignBodyDocument,
  campaignBodyFormatVersion,
} from "./campaign-body-document";
import {
  campaignBodyExtensions,
  campaignBodySchema,
} from "./campaign-body-extensions";
import { InvalidCampaignBody } from "./invalid-campaign-body";

const markdownManager = new MarkdownManager({
  extensions: campaignBodyExtensions,
});

const decodeCampaignBodyDocument =
  Schema.decodeUnknownEffect(CampaignBodyDocument);

/**
 * Parses a Markdown body into a validated campaign body. Besides CommonMark,
 * a line `[[button: Label](https://example.com)]` makes a button.
 */
export const parseCampaignBodyMarkdown = Effect.fn("parseCampaignBodyMarkdown")(
  function* (markdown: string) {
    const doc = yield* Effect.try({
      try: () => markdownManager.parse(markdown),
      catch: InvalidCampaignBody.fromCause,
    });

    return yield* decodeCampaignBodyDocument({
      formatVersion: campaignBodyFormatVersion,
      doc,
    }).pipe(Effect.mapError(InvalidCampaignBody.fromCause));
  }
);

/** Serializes a campaign body back to the Markdown the parser accepts. */
export const campaignBodyToMarkdown = (body: CampaignBodyDocument): string =>
  markdownManager.serialize(campaignBodySchema.nodeFromJSON(body.doc).toJSON());
