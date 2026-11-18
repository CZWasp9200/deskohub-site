import { loadInvoicePreviewPdf } from "@/features/accounting/admin/page-data.server";

/**
 * Serves an invoice preview an administrator's AI agent rendered, to the
 * signed-in administrator it was rendered for, until it expires.
 */
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly previewId: string }> }
) {
  const { previewId } = await params;
  const pdf = await loadInvoicePreviewPdf(previewId);
  return new Response(Uint8Array.from(pdf.bytes), {
    headers: {
      "Content-Disposition": `inline; filename="${pdf.fileName}"`,
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
