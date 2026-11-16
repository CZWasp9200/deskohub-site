import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { toClosedStandardJSONSchemaV1 } from "./closed-json-schema";

const Nested = Schema.Struct({
  name: Schema.String,
  when: Schema.Struct({ day: Schema.NumberFromString }),
});

type JsonObject = {
  readonly additionalProperties?: unknown;
  readonly properties?: Record<string, JsonObject>;
};

const closedness = (schema: JsonObject) => [
  schema.additionalProperties,
  schema.properties?.when?.additionalProperties,
];

describe("toClosedStandardJSONSchemaV1", () => {
  test("closes every object of the input and output JSON Schemas", () => {
    const { jsonSchema } = toClosedStandardJSONSchemaV1(Nested)["~standard"];

    for (const target of ["draft-2020-12", "draft-07"] as const) {
      expect(closedness(jsonSchema.input({ target }))).toEqual([false, false]);
      expect(closedness(jsonSchema.output({ target }))).toEqual([false, false]);
    }
  });

  test("describes the encoded input and the decoded output", () => {
    const { jsonSchema } = toClosedStandardJSONSchemaV1(Nested)["~standard"];
    const day = (schema: JsonObject) =>
      schema.properties?.when?.properties?.day;

    expect(day(jsonSchema.input({ target: "draft-2020-12" }))).toMatchObject({
      type: "string",
    });
    expect(day(jsonSchema.output({ target: "draft-2020-12" }))).not.toEqual(
      day(jsonSchema.input({ target: "draft-2020-12" }))
    );
  });

  test("keeps the validator of a Standard Schema it publishes", async () => {
    const published = toClosedStandardJSONSchemaV1(
      Schema.toStandardSchemaV1(Nested)
    );

    expect(
      await published["~standard"].validate({
        name: "Ada",
        when: { day: "3" },
      })
    ).toEqual({ value: { name: "Ada", when: { day: 3 } } });
  });
});
