import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { legalDocumentKeys } from "@/features/legal/legal-document-path";
import { getLegalDocumentSummary } from "@/features/legal/legal-document-summaries";

mock.module("server-only", () => ({}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("cs-CZ"),
}));

const {
  default: InAppLegalDocumentPage,
  generateMetadata,
  generateStaticParams,
} = await import("./page");

const paramsOf = (document: string) => ({
  params: Promise.resolve({ document }),
});

test("prerenders every legal document", () => {
  expect(generateStaticParams()).toEqual(
    legalDocumentKeys.map((document) => ({ document }))
  );
});

test.each(legalDocumentKeys)(
  "keeps the app's %s out of search results under the document's title",
  async (documentKey) => {
    const metadata = await generateMetadata(paramsOf(documentKey));

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph?.url).toBeUndefined();
    expect(String(metadata.title)).toContain(
      getLegalDocumentSummary("cs-CZ", documentKey).title
    );
  }
);

test("renders the document in the request's locale", async () => {
  const html = renderToStaticMarkup(
    await InAppLegalDocumentPage(paramsOf("privacy-policy"))
  );

  expect(html).toContain(
    `>${getLegalDocumentSummary("cs-CZ", "privacy-policy").title}</h1>`
  );
});

test.each(["unknown", "cs-CZ", "in-app", "privacy-policy.md"])(
  "answers %p, which names no legal document, with not found",
  async (document) => {
    const notFound = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
    await expect(generateMetadata(paramsOf(document))).rejects.toMatchObject(
      notFound
    );
    await expect(
      InAppLegalDocumentPage(paramsOf(document))
    ).rejects.toMatchObject(notFound);
  }
);
