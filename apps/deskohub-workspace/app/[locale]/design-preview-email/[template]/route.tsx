// DESIGN PREVIEW ONLY (online withdrawal visual rounds): renders an email
// template with its synthetic PreviewProps. Development builds only.
import "@/shared/polyfills/temporal";
import { render } from "react-email";
import { notFound } from "next/navigation";
import type { Locale } from "@/features/i18n";
import ContractWithdrawalReceiptEmail from "@/emails/contract-withdrawal-receipt";
import CustomerReservationEmail from "@/emails/customer-reservation";
import ReservationCancellationEmail from "@/emails/reservation-cancellation";

const templates = {
  "contract-withdrawal-receipt": ContractWithdrawalReceiptEmail,
  "customer-reservation": CustomerReservationEmail,
  "reservation-cancellation": ReservationCancellationEmail,
} as const;

const czk = (value: number) => ({ value: value * 100, exponent: 2, currency: "CZK" });

/**
 * `?state=full|partial` for the withdrawal receipt: a Profi day refunded in
 * full, or a four-day office with three days started. Synthetic only.
 */
const withdrawalReceiptProps = (state: string | null, locale: string) => {
  const en = locale === "en-US";
  const partial = state === "partial";
  return {
    reference: partial ? "R-20261117-0043" : "R-20261117-0042",
    customerName: "Jana Nováková",
    receiptEmail: "jana.novakova@deskohub.test",
    contractLabel: partial
      ? en
        ? "Private office · Nov 16 – 19, 2026"
        : "Soukromá kancelář · 16.–19. 11. 2026"
      : en
        ? "Profi · Dec 7, 2026"
        : "Profi · 7. 12. 2026",
    submittedAt: Temporal.Instant.from("2026-11-18T12:01:00Z"),
    paidAmount: partial ? czk(4800) : czk(550),
    refundAmount: partial ? czk(1200) : czk(550),
    refundBasis: partial
      ? { kind: "partial", unit: "day", unstarted: 1, total: 4 }
      : { kind: "full" },
  };
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string; template: string }> }
) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { locale, template } = await params;
  const Email = templates[template as keyof typeof templates];
  if (!Email) notFound();
  const props =
    template === "contract-withdrawal-receipt"
      ? withdrawalReceiptProps(new URL(request.url).searchParams.get("state"), locale)
      : (Email.PreviewProps as object);
  const html = await render(
    <Email {...(props as object as never)} {...({ locale: locale as Locale } as object)} />
  );
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
