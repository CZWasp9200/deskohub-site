import type { LegalSection } from "../legal-document-body";

type LegalDocumentSectionsProps = {
  readonly sections: readonly LegalSection[];
  /** The site's document page, or the mobile app's plain variant. */
  readonly variant: "page" | "in-app";
};

/** A legal document's sections: each heading with its authored paragraphs. */
export function LegalDocumentSections({
  sections,
  variant,
}: LegalDocumentSectionsProps) {
  const classNames = {
    page: {
      section: "space-y-3",
      heading: "text-2xl leading-tight",
      body: "space-y-3 text-base leading-7 text-navy-blue/78",
    },
    "in-app": {
      section: "space-y-4",
      // Headings take their weight from the brand's heading weight.
      heading: "pt-2 text-[1.0625rem] leading-6 [--font-heading-weight:600]",
      body: "space-y-4",
    },
  }[variant];

  return sections.map((section) => (
    <section key={section.heading} className={classNames.section}>
      <h2 className={classNames.heading}>{section.heading}</h2>
      <div className={classNames.body}>
        {section.body.map((paragraph, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Authored paragraphs are ordered and may repeat verbatim.
          <p key={`${section.heading}-${index}`}>{paragraph}</p>
        ))}
      </div>
    </section>
  ));
}
