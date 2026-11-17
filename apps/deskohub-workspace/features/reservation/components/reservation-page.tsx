import { type ReactNode, Suspense } from "react";
import {
  CheckoutFlowLayout,
  CheckoutSteps,
} from "@/features/checkout/components/checkout-flow-layout";
import type { Locale } from "@/features/i18n";
import {
  type PublicPageBreadcrumb,
  PublicPageBreadcrumbs,
} from "@/features/public-pages/components/public-page-breadcrumbs";
import { QueryProvider } from "@/shared/components/query-provider";
import { ReservationCheckoutSteps } from "./reservation-checkout-steps";

type ReservationPageProps = {
  /** The pages above this one, ending with it, when it has a place on the site. */
  readonly breadcrumbs?: ReadonlyArray<PublicPageBreadcrumb>;
  readonly children: ReactNode;
  readonly fallback: ReactNode;
  /** The page's h1 and anything that takes its place above the form. */
  readonly heading: ReactNode;
  readonly locale: Locale;
};

export function ReservationPage({
  breadcrumbs,
  children,
  fallback,
  heading,
  locale,
}: ReservationPageProps) {
  return (
    <CheckoutFlowLayout
      activeStepKey="chooseSpace"
      breadcrumbs={
        breadcrumbs && (
          <PublicPageBreadcrumbs
            crumbs={breadcrumbs}
            locale={locale}
            tone="inverse"
          />
        )
      }
      locale={locale}
      steps={
        // The step lives in the URL, which the prerendered shell can't read.
        <Suspense
          fallback={
            <CheckoutSteps activeStepKey="chooseSpace" locale={locale} />
          }
        >
          <ReservationCheckoutSteps locale={locale} />
        </Suspense>
      }
    >
      {heading}
      <Suspense fallback={fallback}>
        <QueryProvider>{children}</QueryProvider>
      </Suspense>
    </CheckoutFlowLayout>
  );
}

/**
 * The reservation page's h1, shown above the form, or kept only for screen
 * readers and search engines while something else takes its place.
 */
export function ReservationPageTitle({
  title,
  visuallyHidden = false,
}: {
  readonly title: string;
  readonly visuallyHidden?: boolean;
}) {
  return (
    <h1
      className={
        visuallyHidden
          ? "sr-only"
          : "text-4xl leading-tight text-balance sm:text-5xl"
      }
    >
      {title}
    </h1>
  );
}
