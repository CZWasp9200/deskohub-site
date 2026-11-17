import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { DocumentPage } from "@/shared/components/document-page";
import { getLegalDocument } from "../content";
import type { LegalDocumentKey } from "../legal-document-summaries";
import { LegalDocumentSections } from "./legal-document-sections";

type LegalPageProps = {
  locale: Locale;
  documentKey: LegalDocumentKey;
};

export function LegalPage({ locale, documentKey }: LegalPageProps) {
  const document = getLegalDocument(locale, documentKey);

  return (
    <DocumentPage
      eyebrow={m.legalPageEyebrow({}, { locale })}
      title={document.title}
      lead={document.lead}
      meta={
        <>
          <p className="text-sm uppercase tracking-[0.14em] text-navy-blue/46">
            {m.legalPageLastUpdatedLabel({}, { locale })}: {document.updatedAt}
          </p>
          {document.translationNotice === undefined ? null : (
            <p className="max-w-3xl text-sm leading-6 text-navy-blue/62">
              {document.translationNotice}
            </p>
          )}
        </>
      }
    >
      <LegalDocumentSections sections={document.sections} variant="page" />
    </DocumentPage>
  );
}
