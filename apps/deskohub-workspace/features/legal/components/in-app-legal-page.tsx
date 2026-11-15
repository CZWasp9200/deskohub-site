import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { getLegalDocument } from "../content";
import { keepLegalLinksInApp } from "../in-app-legal-links";
import type { LegalDocumentKey } from "../legal-document-path";
import { LegalDocumentSections } from "./legal-document-sections";

type InAppLegalPageProps = {
  readonly locale: Locale;
  readonly documentKey: LegalDocumentKey;
};

/**
 * A legal document as the mobile app opens it in a browser tab: the site
 * page's text and date on plain paper, without the site's header, footer and
 * eyebrow card. Links to other legal documents stay in this variant.
 */
export function InAppLegalPage({ locale, documentKey }: InAppLegalPageProps) {
  const document = getLegalDocument(locale, documentKey);
  const sections = document.sections.map((section) => ({
    heading: section.heading,
    body: section.body.map(keepLegalLinksInApp),
  }));

  return (
    <main className="min-h-screen bg-[#f8f5ef] px-5 pt-4 pb-5 break-words text-navy-blue">
      <div className="mx-auto max-w-3xl">
        <div className="space-y-2 pt-2">
          <h1 className="text-[1.625rem] leading-8 tracking-[-0.3px] [--font-heading-weight:700]">
            {document.title}
          </h1>
          <p className="text-xs font-medium text-[#4a5a72]">
            {m.legalPageLastUpdatedLabel({}, { locale })}: {document.updatedAt}
          </p>
          {document.translationNotice !== undefined && (
            <p className="text-xs font-medium text-[#4a5a72]">
              {document.translationNotice}
            </p>
          )}
        </div>
        <div className="mt-6 space-y-4 text-[0.9375rem] leading-[1.4375rem]">
          <p>{document.lead}</p>
          <LegalDocumentSections sections={sections} variant="in-app" />
        </div>
      </div>
    </main>
  );
}
