import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { InAppLegalPage } from "@/features/legal/components/in-app-legal-page";
import {
  isLegalDocumentKey,
  legalDocumentKeys,
} from "@/features/legal/legal-document-path";
import { getLegalDocumentSummary } from "@/features/legal/legal-document-summaries";
import { createNoindexedPageMetadata } from "@/features/public-pages/page-metadata";

// The proxy rewrites a legal document page the mobile app opens (`native=1`)
// here; the site's page at the same URL keeps its header, footer and consent
// banner. The variant stays out of search results.

type InAppLegalDocumentPageProps = {
  readonly params: Promise<{ readonly document: string }>;
};

export function generateStaticParams() {
  return legalDocumentKeys.map((document) => ({ document }));
}

const findDocumentKey = async (
  params: InAppLegalDocumentPageProps["params"]
) => {
  const { document } = await params;
  if (!isLegalDocumentKey(document)) notFound();
  return document;
};

export async function generateMetadata({
  params,
}: InAppLegalDocumentPageProps): Promise<Metadata> {
  const documentKey = await findDocumentKey(params);
  return runWithRequestLocale((locale) => {
    const { title, lead } = getLegalDocumentSummary(locale, documentKey);
    return createNoindexedPageMetadata({
      locale,
      title: { page: title },
      description: lead,
    });
  });
}

export default async function InAppLegalDocumentPage({
  params,
}: InAppLegalDocumentPageProps) {
  const documentKey = await findDocumentKey(params);
  return runWithRequestLocale((locale) => (
    <InAppLegalPage locale={locale} documentKey={documentKey} />
  ));
}
