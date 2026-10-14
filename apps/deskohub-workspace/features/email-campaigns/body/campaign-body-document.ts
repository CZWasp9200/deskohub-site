import { Schema } from "effect";

/**
 * Version of the stored body format. Bump it, and migrate stored bodies, when
 * a node or attribute is renamed or removed.
 */
export const campaignBodyFormatVersion = 1;

const CampaignBodyAttributeValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
]);

const CampaignBodyAttributes = Schema.Record(
  Schema.String,
  CampaignBodyAttributeValue
);

const CampaignBodyMark = Schema.Struct({
  type: Schema.String,
  attrs: Schema.optionalKey(CampaignBodyAttributes),
});

// A type alias, not an interface, so the node stays assignable to JSON types.
export type CampaignBodyNode = {
  readonly type: string;
  readonly attrs?: typeof CampaignBodyAttributes.Type;
  readonly content?: ReadonlyArray<CampaignBodyNode>;
  readonly marks?: ReadonlyArray<typeof CampaignBodyMark.Type>;
  readonly text?: string;
};

/** A ProseMirror JSON node, as TipTap stores it. */
export const CampaignBodyNode: Schema.Codec<CampaignBodyNode> = Schema.Struct({
  type: Schema.String,
  attrs: Schema.optionalKey(CampaignBodyAttributes),
  content: Schema.optionalKey(
    Schema.Array(
      Schema.suspend((): Schema.Codec<CampaignBodyNode> => CampaignBodyNode)
    )
  ),
  marks: Schema.optionalKey(Schema.Array(CampaignBodyMark)),
  text: Schema.optionalKey(Schema.String),
});

/** One locale's campaign body: a versioned TipTap document. */
export const CampaignBodyDocument = Schema.Struct({
  formatVersion: Schema.Literal(campaignBodyFormatVersion),
  doc: CampaignBodyNode,
}).annotate({
  identifier: "CampaignBodyDocument",
  description: "A campaign email body stored as versioned TipTap JSON.",
});

export type CampaignBodyDocument = typeof CampaignBodyDocument.Type;
