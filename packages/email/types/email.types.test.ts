import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { EmailDeliveryIdSchema } from "./email.types";

describe("EmailDeliveryIdSchema", () => {
  test("rejects empty delivery identifiers", () => {
    expect(
      Option.isNone(Schema.decodeUnknownOption(EmailDeliveryIdSchema)(""))
    ).toBeTrue();
  });
});
