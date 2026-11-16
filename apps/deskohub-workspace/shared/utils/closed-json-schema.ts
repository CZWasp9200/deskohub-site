import { JsonSchema, Schema } from "effect";

const closedDocument = (schema: Schema.Constraint, target: string) => {
  const document = Schema.toJsonSchemaDocument(schema, {
    onExcessProperty: "error",
  });
  if (target === "draft-2020-12") {
    return {
      $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
      ...document.schema,
      ...(Object.keys(document.definitions).length > 0 && {
        $defs: document.definitions,
      }),
    };
  }
  if (target === "draft-07") {
    const draft07 = JsonSchema.toDocumentDraft07(document);
    return {
      $schema: JsonSchema.META_SCHEMA_URI_DRAFT_07,
      ...draft07.schema,
      ...(Object.keys(draft07.definitions).length > 0 && {
        definitions: draft07.definitions,
      }),
    };
  }
  throw new Error(`Unsupported JSON Schema target: ${target}`);
};

/**
 * `Schema.toStandardJSONSchemaV1` whose JSON Schemas close every object
 * (`additionalProperties: false`). Effect 4.1 publishes objects open by
 * default and takes no option here; a published contract that names every
 * key it accepts tells a client that others are refused.
 */
export const toClosedStandardJSONSchemaV1 = <S extends Schema.Constraint>(
  schema: S
) => {
  const published = Schema.toStandardJSONSchemaV1(schema);
  return Object.assign(published, {
    "~standard": {
      ...published["~standard"],
      jsonSchema: {
        input: ({ target }: { readonly target: string }) =>
          closedDocument(schema, target),
        output: ({ target }: { readonly target: string }) =>
          closedDocument(Schema.toType(schema), target),
      },
    },
  });
};
