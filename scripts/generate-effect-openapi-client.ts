import * as OpenApiGenerator from "@effect/openapi-generator/OpenApiGenerator";
import { Effect } from "effect";
import type { OpenAPISpec } from "effect/http-api/OpenApi";

const getArgument = (name: string) => {
  const index = Bun.argv.indexOf(name);
  const value = Bun.argv[index + 1];

  if (index === -1 || !value) {
    throw new Error(`Missing required ${name} argument.`);
  }

  return value;
};

const spec = getArgument("--spec");
const name = getArgument("--name");
const output = getArgument("--output");
const convertNullableTo31 = Bun.argv.includes("--convert-nullable-to-31");

const schemaMarkers = [
  "allOf",
  "anyOf",
  "oneOf",
  "$ref",
  "enum",
  "items",
  "properties",
  "type",
];

const upgradeSchemaObject = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(upgradeSchemaObject);
  if (schema === null || typeof schema !== "object") return schema;

  const object = schema as Record<string, unknown>;
  const upgraded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (key !== "nullable" && key !== "example") {
      upgraded[key] = upgradeSchemaObject(value);
    }
  }
  if (!schemaMarkers.some((marker) => marker in object)) return upgraded;

  if (object.example !== undefined) upgraded.examples = [object.example];
  return object.nullable === true
    ? { anyOf: [upgraded, { type: "null" }] }
    : upgraded;
};

const asOpenApi31Document = (
  document: Record<string, unknown>
): Record<string, unknown> => {
  const upgraded: Record<string, unknown> = { ...document, openapi: "3.1.0" };
  for (const section of ["paths", "components"]) {
    if (upgraded[section] !== undefined) {
      upgraded[section] = upgradeSchemaObject(upgraded[section]);
    }
  }
  return upgraded;
};

const specDocument = Bun.YAML.parse(await Bun.file(spec).text()) as Record<
  string,
  unknown
>;

// `closeObjects` keeps objects that omit `additionalProperties` as plain
// `Schema.Struct`s (with `.fields`), as the generated clients and their
// consumers expect, instead of open `StructWithRest` records of JSON values.
const generatedSource = await Effect.runPromise(
  Effect.gen(function* () {
    const generator = yield* OpenApiGenerator.OpenApiGenerator;
    return yield* generator.generate(
      (convertNullableTo31
        ? asOpenApi31Document(specDocument)
        : specDocument) as unknown as OpenAPISpec,
      {
        name,
        format: "httpclient",
        closeObjects: true,
        onWarning: (warning) =>
          console.error(OpenApiGenerator.formatWarning(warning)),
      }
    );
  }).pipe(Effect.provide(OpenApiGenerator.layerTransformerSchema))
);

const diagnosticHeader =
  "// @effect-diagnostics schemaNumber:off unnecessaryTypeofType:off\n";

const generatedErrorDecoder =
  "HttpClientResponse.schemaBodyJson(schema)(response)";
const statusPreservingErrorDecoder = `${generatedErrorDecoder}.pipe(
          Effect.mapError(
            () =>
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.StatusCodeError({
                  request: response.request,
                  response,
                  description: "Error response did not match the documented schema",
                }),
              }),
          ),
        )`;

// The generator emits `decodeError` only for clients that decode documented
// error responses; a client without it has no error decoder to harden.
const hardenErrorDecoder = (source: string): string => {
  const decodeErrorStart = source.indexOf("  const decodeError =");
  if (decodeErrorStart === -1 && !source.includes("decodeError(")) {
    return source;
  }
  const decoderStart = source.indexOf(generatedErrorDecoder, decodeErrorStart);
  const operationsStart = source.indexOf("  return {", decodeErrorStart);

  if (
    decodeErrorStart === -1 ||
    decoderStart === -1 ||
    operationsStart === -1 ||
    decoderStart >= operationsStart
  ) {
    throw new Error("Could not find the generated error response decoder.");
  }

  return `${source.slice(0, decoderStart)}${statusPreservingErrorDecoder}${source.slice(decoderStart + generatedErrorDecoder.length)}`;
};

await Bun.write(
  output,
  `${diagnosticHeader}${hardenErrorDecoder(generatedSource)}\n`
);
