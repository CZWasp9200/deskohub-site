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
import { type DotyposTable, DotyposTableIdSchema } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceCheckoutNetworkDetailsService } from "@/features/checkout/backend/fulfillment/network-details.service";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { ReservationOnSite } from "@/features/reservation/backend/reservation-on-site-details";

// Stub Dotypos tables: reserved desk 12, and Open Space tables 1–8 and 10.
const stubTable = (name: string, tag: string, seats: string): DotyposTable =>
  ({
    _cloudId: "cloud",
    id: `table-${name}`,
    name,
    display: true,
    enabled: true,
    locationName: "Main room",
    seats,
    tags: [tag],
  }) as DotyposTable;
const stubTables = [
  stubTable("12", "cowork:reserved-desk", "1"),
  ...["1", "2", "3", "4", "5", "6", "7", "8", "10"].map((name) =>
    stubTable(name, "cowork:open-space", "4")
  ),
];

/** The featured booking's table and Wi-Fi through the real on-site service. */
const loadOnSite = (placement: string | undefined) =>
  Effect.runPromise(
    Effect.flatMap(ReservationOnSite, (onSite) =>
      onSite.forReservations([
        {
          id: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C" as never,
          reservationDetails:
            placement === "shared"
              ? { kind: "cowork", entryTier: "open-space", coffee: false }
              : {
                  kind: "cowork",
                  entryTier: "profi",
                  coffee: true,
                  monitorOption: "2x27-qhd",
                } as never,
          dotyposReservation:
            placement === "none"
              ? {}
              : { _tableId: DotyposTableIdSchema.make("table-12") },
        },
      ])
    ).pipe(
      Effect.map((details) => [...details.values()][0]),
      Effect.provide(
        ReservationOnSite.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(AdvisoryAvailabilityInventory, {
                tables: Effect.succeed(stubTables),
              } as never),
              WorkspaceCheckoutNetworkDetailsService.Default
            )
          )
        )
      )
    )
  );

const designPreviewReservation = {
  id: "R-20261117-0042",
  orderId: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
  workspaceReservationId: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
  product: { kind: "cowork", tier: "profi" },
  startsAt: "2026-12-06T23:00:00Z",
  endsAt: "2026-12-07T23:00:00Z",
  seats: 1,
  status: "confirmed",
  withdrawal: { eligible: true, periodEndsAt: "2026-12-01T23:00:00Z" },
} as const;

const designPreviewMeetingRoom = {
  id: "R-20261117-0043",
  orderId: "workspace_01JY4K2T9B7C3D5E6F8G9H0J1K",
  workspaceReservationId: "workspace_01JY4K2T9B7C3D5E6F8G9H0J1K",
  product: { kind: "meeting-room" },
  startsAt: "2026-12-03T08:00:00Z",
  endsAt: "2026-12-03T11:00:00Z",
  seats: 6,
  status: "confirmed",
  withdrawal: { eligible: true, periodEndsAt: "2026-12-01T23:00:00Z" },
} as const;

const designPreviewPast = {
  id: "R-20261020-0017",
  orderId: "workspace_01JX9M4N6P8Q0R2S4T6V8W0X2Y",
  workspaceReservationId: "workspace_01JX9M4N6P8Q0R2S4T6V8W0X2Y",
  product: { kind: "cowork", tier: "profi" },
  startsAt: "2026-10-20T22:00:00Z",
  endsAt: "2026-10-21T22:00:00Z",
  seats: 1,
  status: "confirmed",
} as const;

const designPreviewState = (
  eligible: boolean,
  onSite: unknown,
  shared: boolean
) => ({
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
      current: [designPreviewReservation, designPreviewMeetingRoom].map(
        (reservation, index) => ({
          ...reservation,
          withdrawal: { ...reservation.withdrawal, eligible },
          ...(index === 0 && {
            onSite,
            ...(shared && {
              product: { kind: "cowork", tier: "open-space" },
            }),
          }),
        })
      ),
      past: [designPreviewPast],
      unavailable: [],
    },
  },
  avatar: { kind: "hidden" },
  referralsEnabled: true,
});

const designPreviewStatus: CheckoutStatusViewModel = {
  kind: "cowork",
  orderId: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
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
  const { placement, state, view } = await searchParams;
  const onSite = await loadOnSite(placement);

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
          state={
            designPreviewState(
              state !== "ineligible",
              onSite,
              placement === "shared"
            ) as never
          }
        />
      </AccountLayoutShell>
      {view === "modal" && (
        <ReservationDetailsModal locale={locale}>
          <CheckoutStatusPage
            locale={locale}
            presentation="modal"
            status={designPreviewStatus}
          />
        </ReservationDetailsModal>
      )}
    </>
  ));
}
