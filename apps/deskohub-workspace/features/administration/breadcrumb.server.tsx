import "server-only";

import { loadInvoiceAdministrationBreadcrumbLabel } from "@/features/accounting/admin/invoice-breadcrumb.server";
import { AdministrationBreadcrumbs } from "@/features/administration/admin-shell";
import {
  loadAdministrationBookingBreadcrumbLabel,
  loadAdministrationReservationBreadcrumbLabel,
} from "@/features/administration/page-data.server";
import { requireDotyposCustomerRouteId } from "@/features/administration/route-identifiers.server";
import { loadDiscountAdminCustomerBreadcrumbLabel } from "@/features/discounts/admin/page-data.server";
import {
  loadAudienceBreadcrumbLabel,
  loadCampaignBreadcrumbLabel,
} from "@/features/email-campaigns/admin/campaign-page-data.server";

const newEntityLabels: Readonly<Record<string, string>> = {
  "email-audiences": "New audience",
  "email-campaigns": "New campaign",
};

export async function AdministrationBreadcrumb({
  segments,
}: {
  readonly segments: readonly string[];
}) {
  let entityLabel: string | undefined;

  if (segments[0] === "customers" && segments[1]) {
    entityLabel = await loadDiscountAdminCustomerBreadcrumbLabel(
      requireDotyposCustomerRouteId(segments[1])
    );
  } else if (segments[0] === "reservations" && segments[1]) {
    entityLabel =
      (await loadAdministrationReservationBreadcrumbLabel(segments[1])) ??
      undefined;
  } else if (segments[0] === "bookings" && segments[1]) {
    entityLabel = await loadAdministrationBookingBreadcrumbLabel(segments[1]);
  } else if (
    segments[0] === "invoices" &&
    segments[1] &&
    segments[1] !== "new"
  ) {
    entityLabel = await loadInvoiceAdministrationBreadcrumbLabel(segments[1]);
  } else if (segments[0] && segments[1] === "new") {
    entityLabel = newEntityLabels[segments[0]];
  } else if (segments[0] === "email-campaigns" && segments[1]) {
    entityLabel = await loadCampaignBreadcrumbLabel(segments[1]);
  } else if (segments[0] === "email-audiences" && segments[1]) {
    entityLabel = await loadAudienceBreadcrumbLabel(segments[1]);
  }

  const segmentLabels =
    entityLabel && segments[1] ? { [segments[1]]: entityLabel } : undefined;

  return (
    <AdministrationBreadcrumbs
      entityLabel={segments.length === 2 ? entityLabel : undefined}
      segmentLabels={segmentLabels}
      segments={["admin", ...segments]}
    />
  );
}
