import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Result, Schema } from "effect";
import {
  CampaignBodyDocument,
  type CampaignBodyNode,
} from "./campaign-body-document";

const decode = Schema.decodeUnknownResult(CampaignBodyDocument);

const body = (...content: ReadonlyArray<CampaignBodyNode>) => ({
  formatVersion: 1,
  doc: { type: "doc", content },
});

const text = (value: string, marks?: CampaignBodyNode["marks"]) =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };

const paragraph = (...content: ReadonlyArray<CampaignBodyNode>) => ({
  type: "paragraph",
  content,
});

const link = (href: string) =>
  paragraph(text("odkaz", [{ type: "link", attrs: { href, title: null } }]));

const image = (src: string) => ({
  type: "image",
  attrs: { src, alt: "Workspace", title: null },
});

const cta = (attrs: CampaignBodyNode["attrs"]) => ({
  type: "ctaButton",
  attrs,
});

const cloudinaryImage =
  "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/autumn.jpg";

const failureMessage = (input: {
  readonly formatVersion: number;
  readonly doc: CampaignBodyNode;
}): string => {
  const result = decode(input);
  return Result.isFailure(result) ? result.failure.message : "";
};

describe("CampaignBodyDocument", () => {
  test("accepts every node and mark of the content set", () => {
    const document = body(
      { type: "heading", attrs: { level: 2 }, content: [text("Novinky")] },
      paragraph(
        text("tučně", [{ type: "bold" }]),
        text(" a "),
        text("kurzívou", [{ type: "italic" }])
      ),
      link("https://workspace.deskohub.cz"),
      link(`mailto:${testEmailAddress("campaign")}`),
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph(text("jedna"))] }],
      },
      {
        type: "orderedList",
        attrs: { start: 1 },
        content: [{ type: "listItem", content: [paragraph(text("první"))] }],
      },
      image(cloudinaryImage),
      { type: "horizontalRule" },
      cta({ label: "Rezervovat", href: "https://workspace.deskohub.cz" })
    );

    expect(decode(document)).toEqual(Result.succeed(document));
  });

  test("rejects a node outside the content set", () => {
    expect(failureMessage(body({ type: "table" }))).toContain(
      "Unknown node type: table"
    );
  });

  test("rejects a mark outside the content set", () => {
    expect(
      failureMessage(body(paragraph(text("x", [{ type: "strike" }]))))
    ).toContain("strike");
  });

  test("rejects invalid nesting", () => {
    expect(
      failureMessage(body({ type: "bulletList", content: [text("x")] }))
    ).toContain("Invalid content for node bulletList");
  });

  test("rejects a root that isn't a doc node", () => {
    expect(
      failureMessage({ formatVersion: 1, doc: paragraph(text("x")) })
    ).toContain('A body must be a "doc" node.');
  });

  test("rejects an unknown format version", () => {
    expect(Result.isFailure(decode({ ...body(), formatVersion: 2 }))).toBe(
      true
    );
  });

  test.each([
    "javascript:alert(1)",
    "http://workspace.deskohub.cz",
    "data:text/html,hi",
    "/relative",
  ])("rejects the link %s", (href) => {
    expect(failureMessage(body(link(href)))).toContain(
      "A link must use an https: or mailto: URL."
    );
  });

  test.each([
    "https://example.com/image.jpg",
    "https://res.cloudinary.com/another-cloud/image/upload/v1/a.jpg",
    "http://res.cloudinary.com/cloud/image/upload/v1/a.jpg",
    "https://res.cloudinary.com/cloud/video/upload/v1/a.mp4",
  ])("rejects the image %s", (src) => {
    expect(failureMessage(body(image(src)))).toContain(
      "An image must come from the Deskohub Cloudinary account."
    );
  });

  test("rejects a button without a label", () => {
    expect(
      failureMessage(body(cta({ label: "  ", href: "https://deskohub.cz" })))
    ).toContain("A button needs a label.");
  });

  test.each(["Book\rnow", "Book\r\nnow"])(
    "rejects the button label %p, which Markdown can't keep",
    (label) => {
      expect(
        failureMessage(body(cta({ label, href: "https://deskohub.cz" })))
      ).toContain("A button label must break lines with line feeds only.");
    }
  );

  test("rejects a button without a safe URL", () => {
    expect(failureMessage(body(cta({ label: "Klik", href: null })))).toContain(
      "A button needs an https: or mailto: URL."
    );
    expect(
      failureMessage(body(cta({ label: "Klik", href: "javascript:void(0)" })))
    ).toContain("A button needs an https: or mailto: URL.");
  });
});
