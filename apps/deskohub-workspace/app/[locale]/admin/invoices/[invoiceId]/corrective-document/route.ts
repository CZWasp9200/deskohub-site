import { loadInvoiceAdministrationCorrectiveDocumentPdf } from "@/features/accounting/admin/page-data.server";

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly invoiceId: string }> }
) {
  const { invoiceId } = await params;
  const pdf = await loadInvoiceAdministrationCorrectiveDocumentPdf(invoiceId);
  return new Response(Uint8Array.from(pdf.bytes), {
    headers: {
      "Content-Disposition": `inline; filename="${pdf.fileName}"`,
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
    },
  });
}
