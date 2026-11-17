// DESIGN PREVIEW ONLY (online withdrawal visual rounds). Renders the real
// account and reservation-status components with a hardcoded, synthetic
// eligible reservation. Development builds only; removed before review.
import "@/shared/polyfills/temporal";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";
import { AccountPage } from "@/features/account/components/account-page";
import type { CheckoutStatusViewModel } from "@/features/checkout/backend/checkout";
import { CheckoutStatusPage } from "@/features/checkout/components/checkout-status-page";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { ReservationDetailsModal } from "@/features/reservation/components/reservation-details-modal";

const designPreviewReservation = {
  id: "R-20261117-0042",
  orderId: "0193b4f2-7c1e-7a4b-9d2e-5f8a1c3b6d20",
  workspaceReservationId: "0193b4f2-7c1e-7a4b-9d2e-5f8a1c3b6d20",
  product: { kind: "cowork", tier: "profi" },
  startsAt: "2026-12-06T23:00:00Z",
  endsAt: "2026-12-07T23:00:00Z",
  seats: 1,
  status: "confirmed",
  withdrawal: { periodEndsAt: "2026-12-01T22:59:59Z" },
} as const;

const designPreviewMeetingRoom = {
  id: "R-20261117-0043",
  orderId: "0193b4f2-91a0-7c55-8e14-2b6d0f7a3c41",
  workspaceReservationId: "0193b4f2-91a0-7c55-8e14-2b6d0f7a3c41",
  product: { kind: "meeting-room" },
  startsAt: "2026-12-03T08:00:00Z",
  endsAt: "2026-12-03T11:00:00Z",
  seats: 6,
  status: "confirmed",
  withdrawal: { periodEndsAt: "2026-12-01T22:59:59Z" },
} as const;

const designPreviewPast = {
  id: "R-20261020-0017",
  orderId: "0192af10-3d2e-7b19-a6c7-9e0d4f1b8a52",
  workspaceReservationId: "0192af10-3d2e-7b19-a6c7-9e0d4f1b8a52",
  product: { kind: "cowork", tier: "profi" },
  startsAt: "2026-10-20T22:00:00Z",
  endsAt: "2026-10-21T22:00:00Z",
  seats: 1,
  status: "confirmed",
} as const;

const designPreviewState = {
  kind: "linked",
  deletion: "offered",
  email: "jana.novakova@deskohub.test",
  profile: {
    firstName: "Jana",
    lastName: "Nováková",
    phone: null,
    billing: null,
  },
  history: {
    kind: "available",
    groups: {
      current: [designPreviewReservation, designPreviewMeetingRoom],
      past: [designPreviewPast],
      unavailable: [],
    },
  },
  avatar: { kind: "hidden" },
  referralsEnabled: true,
} as const;

const designPreviewStatus: CheckoutStatusViewModel = {
  kind: "cowork",
  orderId: "0193b4f2-7c1e-7a4b-9d2e-5f8a1c3b6d20",
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

const loadInvoiceHistory = async () => {
  "use server";
  return { kind: "unavailable" } as never;
};

export default async function WithdrawalDesignPreviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  await connection();
  const { view } = await searchParams;

  return runWithRequestLocale((locale) => (
    <>
      <AccountLayoutShell
        locale={locale}
        passkeysEnabled={false}
        referralsEnabled
        signedIn
      >
        <AccountPage
          loadInvoiceHistory={loadInvoiceHistory}
          locale={locale}
          state={designPreviewState as never}
        />
      </AccountLayoutShell>
      {view === "modal" && (
        <ReservationDetailsModal locale={locale}>
          <CheckoutStatusPage
            locale={locale}
            presentation="modal"
            status={designPreviewStatus}
            withdrawalOffer={{ periodEndsAt: "2026-12-01T22:59:59Z" }}
          />
        </ReservationDetailsModal>
      )}
    </>
  ));
}
