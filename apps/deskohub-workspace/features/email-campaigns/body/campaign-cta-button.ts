import { Node } from "@tiptap/core";

const ctaButtonMarkdownPattern =
  /^\[\[button:\s*(.+?)\]\(([^)\s]+)\)\](?:\r?\n|$)/;

/**
 * A call-to-action button: a label and a URL rendered as a prominent link.
 * Markdown spells it `[[button: Label](https://example.com)]` on its own line.
 */
export const CampaignCtaButton = Node.create({
  name: "ctaButton",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      href: { default: null },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-cta-button]",
        getAttrs: (element) => ({
          href: element.getAttribute("href"),
          label: element.textContent ?? "",
        }),
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "a",
      { "data-cta-button": "", href: node.attrs.href },
      node.attrs.label,
    ];
  },

  markdownTokenizer: {
    name: "ctaButton",
    level: "block",
    start: (source) => source.indexOf("[[button:"),
    tokenize: (source) => {
      const match = ctaButtonMarkdownPattern.exec(source);

      return match
        ? {
            type: "ctaButton",
            raw: match[0],
            label: match[1]?.trim(),
            href: match[2],
          }
        : undefined;
    },
  },

  parseMarkdown: (token) => ({
    type: "ctaButton",
    attrs: { href: token.href, label: token.label },
  }),

  renderMarkdown: (node) =>
    `[[button: ${node.attrs?.label ?? ""}](${node.attrs?.href ?? ""})]`,
});
