// DESIGN PREVIEW ONLY (online withdrawal visual rounds): renders an email
// template with its synthetic PreviewProps. Development builds only.
import { render } from "react-email";
import { notFound } from "next/navigation";
import type { Locale } from "@/features/i18n";
import CustomerReservationEmail from "@/emails/customer-reservation";
import ReservationCancellationEmail from "@/emails/reservation-cancellation";

const templates = {
  "customer-reservation": CustomerReservationEmail,
  "reservation-cancellation": ReservationCancellationEmail,
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; template: string }> }
) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { locale, template } = await params;
  const Email = templates[template as keyof typeof templates];
  if (!Email) notFound();
  const html = await render(
    <Email {...(Email.PreviewProps as object)} {...({ locale: locale as Locale } as object)} />
  );
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
