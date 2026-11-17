// DESIGN PREVIEW ONLY (online withdrawal visual rounds, screen 02): the
// reservation status view opened directly by URL (page presentation), with
// a synthetic confirmed reservation. Development builds only.
import "@/shared/polyfills/temporal";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout";
import { CheckoutStatusPage } from "@/features/checkout/components/checkout-status-page";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

const orderId = "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C";

const designPreviewStatus = {
  kind: "cowork",
  orderId,
  returnOutcome: "success",
  status: "fulfilled",
  paymentStatus: "paid",
  fulfillmentStatus: "fulfilled",
  summary: {
    kind: "cowork",
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x27-qhd",
    reservedFrom: Temporal.Instant.from("2026-12-06T23:00:00Z"),
    reservedUntil: Temporal.Instant.from("2026-12-07T23:00:00Z"),
    price: { value: 55_000, exponent: 2, currency: "CZK" },
  },
} as CheckoutStatusViewModel;

export default async function StatusPageDesignPreview({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  await connection();
  const { state } = await searchParams;

  return runWithRequestLocale((locale) => (
    <CheckoutStatusPage
      locale={locale}
      presentation="page"
      status={designPreviewStatus}
      withdrawalHref={
        state === "ineligible"
          ? undefined
          : `/${locale}/reservation/status/${orderId}?withdraw=1`
      }
    />
  ));
}
