import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit } from "effect";
import {
  campaignBodyToMarkdown,
  parseCampaignBodyMarkdown,
} from "./campaign-body-markdown";

const cloudinaryImage =
  "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/autumn.jpg";

const parse = (markdown: string) =>
  Effect.runPromise(parseCampaignBodyMarkdown(markdown));

describe("campaign body Markdown", () => {
  test.each([
    ["heading 1", "# Podzim ve Workspace", "heading"],
    ["heading 2", "## Novinky", "heading"],
    ["heading 3", "### Detaily", "heading"],
    ["paragraph", "Čeština: žluťoučký kůň úpěl ďábelské ódy.", "paragraph"],
    ["bold", "Tohle je **důležité**.", "paragraph"],
    ["italic", "Tohle je *zdůrazněné*.", "paragraph"],
    ["link", "Více na [webu](https://workspace.deskohub.cz).", "paragraph"],
    [
      "mailto link",
      `Napište na [e-mail](mailto:${testEmailAddress("campaign")}).`,
      "paragraph",
    ],
    ["bullet list", "- jedna\n- dva **tučně**", "bulletList"],
    ["ordered list", "1. první\n2. druhá", "orderedList"],
    ["image", `![Nová zasedačka](${cloudinaryImage})`, "image"],
    ["divider", "Nad čarou\n\n---\n\nPod čarou", "horizontalRule"],
    [
      "button",
      "[[button: Rezervovat](https://workspace.deskohub.cz/cs-CZ/meeting-room)]",
      "ctaButton",
    ],
  ])("round-trips a %s", async (_name, markdown, nodeType) => {
    const body = await parse(markdown);

    expect(body.formatVersion).toBe(1);
    expect(body.doc.content?.map((node) => node.type)).toContain(nodeType);
    expect(campaignBodyToMarkdown(body)).toBe(markdown);
  });

  test("parses a button's label and URL", async () => {
    const body = await parse("[[button: Book now](https://deskohub.cz/book)]");

    expect(body.doc.content).toEqual([
      {
        type: "ctaButton",
        attrs: { label: "Book now", href: "https://deskohub.cz/book" },
      },
    ]);
  });

  test.each([
    ["javascript link", "[x](javascript:alert(1))"],
    ["external image", "![x](https://example.com/a.jpg)"],
    ["insecure button", "[[button: Go](http://deskohub.cz)]"],
  ])("rejects a %s", async (_name, markdown) => {
    const exit = await Effect.runPromiseExit(
      parseCampaignBodyMarkdown(markdown)
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain("InvalidCampaignBody");
  });
});
