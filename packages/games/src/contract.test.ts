import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { ApiGamesParams, Game } from "./generated/effect.gen";

describe("generated games API contract", () => {
  test("rejects an undocumented game language", () => {
    expect(() =>
      Schema.decodeUnknownSync(Game)({
        id: 1,
        bggId: 13,
        name: "Catan",
        inStock: true,
        language: "de",
        addedAt: "2026-08-20T14:32:00.000Z",
        updatedAt: "2026-08-28T09:10:00.000Z",
      })
    ).toThrow();
  });

  test("accepts only the documented all-games flag", () => {
    const decodeParams = Schema.decodeUnknownSync(ApiGamesParams);

    expect(decodeParams({})).toEqual({});
    expect(decodeParams({ all: "1" })).toEqual({ all: "1" });
    expect(() => decodeParams({ all: "2" })).toThrow();
  });
});
