import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import { Button, Heading, Hr, Img, Link, Section, Text } from "react-email";
import type { CampaignBodyDocument } from "./campaign-body-document";
import {
  campaignBodyExtensions,
  campaignBodySchema,
} from "./campaign-body-extensions";

const headingClassNames = {
  1: "m-0 mt-6 text-[26px] font-bold leading-[34px] text-navy sm:text-[30px] sm:leading-[38px]",
  2: "m-0 mt-6 text-[21px] font-bold leading-[28px] text-navy",
  3: "m-0 mt-5 text-[17px] font-bold leading-[24px] text-navy",
} as const;

const headingLevel = (node: ProseMirrorNode): 1 | 2 | 3 => {
  const level = node.attrs.level;
  return level === 1 || level === 2 ? level : 3;
};

const isInListItem = (parent: ProseMirrorNode | undefined): boolean =>
  parent?.type.name === "listItem";

const listClassName = "m-0 mt-4 pl-6 text-[16px] leading-[25px] text-[#373a59]";

/** Renders a campaign body as React Email components. */
export function CampaignBodyContent({
  body,
}: {
  readonly body: CampaignBodyDocument;
}) {
  return renderToReactElement({
    content: campaignBodySchema.nodeFromJSON(body.doc),
    extensions: campaignBodyExtensions,
    options: {
      nodeMapping: {
        heading: ({ node, children }) => {
          const level = headingLevel(node);
          return (
            <Heading as={`h${level}`} className={headingClassNames[level]}>
              {children}
            </Heading>
          );
        },
        // Email clients add paragraph margins inside list items; keep list
        // items tight and give top-level paragraphs the body spacing.
        paragraph: ({ node, parent, children }) =>
          isInListItem(parent) ? (
            <Text className="m-0 text-[16px] leading-[25px] text-[#373a59]">
              {node.childCount > 0 ? children : " "}
            </Text>
          ) : (
            <Text className="m-0 mt-4 text-[16px] leading-[25px] text-[#373a59]">
              {node.childCount > 0 ? children : " "}
            </Text>
          ),
        bulletList: ({ children }) => (
          <ul className={listClassName}>{children}</ul>
        ),
        orderedList: ({ node, children }) => (
          <ol className={listClassName} start={node.attrs.start ?? 1}>
            {children}
          </ol>
        ),
        listItem: ({ children }) => <li className="mt-1">{children}</li>,
        image: ({ node }) => (
          <Img
            alt={node.attrs.alt ?? ""}
            className="mt-4 block h-auto w-full max-w-full rounded-2xl"
            src={node.attrs.src}
            width="534"
          />
        ),
        horizontalRule: () => (
          <Hr className="m-0 mt-6 border-[#e6ded2] border-solid" />
        ),
        ctaButton: ({ node }) => (
          <Section className="mt-6 text-center">
            <Button
              className="rounded-full bg-aquamarine px-7 py-3 text-[14px] font-bold leading-[20px] text-navy no-underline"
              href={node.attrs.href}
              style={{ backgroundColor: "#00df99", color: "#00024f" }}
            >
              {node.attrs.label}
            </Button>
          </Section>
        ),
      },
      markMapping: {
        bold: ({ children }) => <strong>{children}</strong>,
        italic: ({ children }) => <em>{children}</em>,
        link: ({ mark, children }) => (
          <Link className="text-green underline" href={mark.attrs.href}>
            {children}
          </Link>
        ),
      },
    },
  });
}
