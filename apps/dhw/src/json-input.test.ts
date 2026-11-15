import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { decodeJsonInput } from "./json-input";

const Input = Schema.Struct({
  count: Schema.Number,
  nested: Schema.Struct({ flag: Schema.Boolean }),
});

const decodeFailure = (contents: string) =>
  decodeJsonInput(Input, "test input", contents).pipe(
    Effect.flip,
    Effect.runPromise
  );

describe("decodeJsonInput", () => {
  test("rejects an unknown key at any depth", async () => {
    const error = await decodeFailure(
      JSON.stringify({ count: 1, nested: { flag: true, extra: 1 } })
    );

    expect(error._tag).toBe("InvalidMutationInputError");
    expect(error.message).toContain('["nested"]["extra"]');
  });

  test("reports every invalid value and names each one", async () => {
    const error = await decodeFailure(
      JSON.stringify({ count: "seven", nested: { flag: "maybe" } })
    );

    expect(error.message).toContain('["count"]');
    expect(error.message).toContain('"seven"');
    expect(error.message).toContain('["nested"]["flag"]');
    expect(error.message).toContain('"maybe"');
  });
});
