import { describe, expect, test } from "bun:test";
import * as Schema from "effect/Schema";
import {
  CloudinaryAssetSchema,
  CloudinaryPublicIdSchema,
  SearchOptionsSchema,
} from "./schema";

describe("Cloudinary schemas", () => {
  test("decodes non-empty Cloudinary public IDs", () => {
    const decode = Schema.decodeUnknownSync(CloudinaryPublicIdSchema);

    expect(String(decode("gallery/image"))).toBe("gallery/image");
    expect(() => decode("")).toThrow();
  });

  test("accepts a minimal asset and search options", () => {
    expect(
      Schema.is(CloudinaryAssetSchema)({
        public_id: "gallery/image",
        secure_url: "https://res.cloudinary.com/demo/image/upload/image.jpg",
        url: "http://res.cloudinary.com/demo/image/upload/image.jpg",
        width: 1200,
        height: 800,
        format: "jpg",
        resource_type: "image",
        created_at: "2026-06-20T10:00:00Z",
      })
    ).toBeTrue();
    expect(
      Schema.is(SearchOptionsSchema)({ maxResults: 10, sortBy: "created_at" })
    ).toBeTrue();
  });

  test("rejects invalid search options", () => {
    expect(Schema.is(SearchOptionsSchema)({ maxResults: 0 })).toBeFalse();
    expect(Schema.is(SearchOptionsSchema)({ sortBy: "folder" })).toBeFalse();
  });

  test("rejects assets with empty public IDs at the provider boundary", () => {
    expect(
      Schema.is(CloudinaryAssetSchema)({
        public_id: "",
        secure_url: "https://res.cloudinary.com/demo/image/upload/image.jpg",
        url: "http://res.cloudinary.com/demo/image/upload/image.jpg",
        width: 1200,
        height: 800,
        format: "jpg",
        resource_type: "image",
        created_at: "2026-06-20T10:00:00Z",
      })
    ).toBeFalse();
  });

  test("rejects empty immutable asset identities at the provider boundary", () => {
    expect(
      Schema.is(CloudinaryAssetSchema)({
        asset_id: "",
        public_id: "gallery/image",
        secure_url: "https://res.cloudinary.com/demo/image/upload/image.jpg",
        url: "http://res.cloudinary.com/demo/image/upload/image.jpg",
        width: 1200,
        height: 800,
        format: "jpg",
        resource_type: "image",
        created_at: "2026-06-20T10:00:00Z",
      })
    ).toBeFalse();
  });
});
