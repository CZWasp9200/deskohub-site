// DESIGN PREVIEW ONLY (online withdrawal visual rounds, screen 00): a board
// of the shared reservation PIN button and the ⋮ reservation menu, rendered
// from the real components. Development builds only; removed before review.
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { ReservationAccessButton } from "@/features/reservation/components/reservation-access-button";
import { ReservationOptionsMenu } from "@/features/reservation/components/reservation-options-menu";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/ui/status-badge";

const accessHref = "/en-US/reservation/access/workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C";
const withdrawalHref =
  "/en-US/reservation/status/workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C?withdraw=1";

function Cell({
  caption,
  children,
  state,
}: {
  readonly caption: string;
  readonly children: ReactNode;
  readonly state?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[#94a3b8]">
        {caption}
      </p>
      <div className="@container min-w-0" data-force-state={state}>
        {children}
      </div>
    </div>
  );
}

function Board({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section
      className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8"
      data-board
    >
      <h1 className="mb-6 font-mono text-xs uppercase tracking-[0.14em] text-[#64748b]">
        {title}
      </h1>
      <div className="rounded-2xl border border-[#dfe4ec] bg-white p-6 shadow-[0_18px_40px_-28px_rgba(0,2,79,0.35)]">
        {children}
      </div>
    </section>
  );
}

export default async function FoundationsDesignPreviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  await connection();
  const { section } = await searchParams;

  return runWithRequestLocale((locale) =>
    section === "pin-disabled" ? (
      <Board title="00 · Reservation PIN button · disabled">
        <div className="grid min-w-0 gap-8 sm:grid-cols-2">
          <Cell caption="Proposed · disabled (code not available)">
            <ReservationAccessButton
              className="@3xl:w-auto"
              href={undefined}
              locale={locale}
              unavailableNote={m.accountReservationPinUnavailable(
                {},
                { locale }
              )}
            />
          </Cell>
          <Cell caption="Proposed · disabled (review account)">
            <ReservationAccessButton
              className="@3xl:w-auto"
              href={undefined}
              locale={locale}
              unavailableNote={m.accountReservationPinReviewSandbox(
                {},
                { locale }
              )}
            />
          </Cell>
        </div>
      </Board>
    ) : section === "menu" ? (
      <Board title="00 · Reservation ⋮ menu">
        <div className="grid min-w-0 gap-8">
          <Cell caption="Closed (featured card header)">
            <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-[#e9b8a7] px-5 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <StatusBadge tone="positive">
                  {m.accountReservationStatusConfirmed({}, { locale })}
                </StatusBadge>
                <code className="min-w-0 break-all font-mono text-sm text-[#64748b]">
                  R-20261117-0042
                </code>
              </div>
              <ReservationOptionsMenu
                locale={locale}
                withdrawalHref={withdrawalHref}
              />
            </div>
          </Cell>
          <Cell caption="Open">
            <div className="flex min-h-36 min-w-0 items-start justify-between gap-3 rounded-2xl border border-[#e9b8a7] px-5 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <StatusBadge tone="positive">
                  {m.accountReservationStatusConfirmed({}, { locale })}
                </StatusBadge>
                <code className="min-w-0 break-all font-mono text-sm text-[#64748b]">
                  R-20261117-0042
                </code>
              </div>
              <ReservationOptionsMenu
                defaultOpen
                locale={locale}
                withdrawalHref={withdrawalHref}
              />
            </div>
          </Cell>
        </div>
      </Board>
    ) : (
      <Board title="00 · Reservation PIN button">
        <div className="grid min-w-0 gap-8 sm:grid-cols-2">
          <Cell caption="Current · account card">
            <Button
              className="@3xl:w-auto"
              fullWidth
              size="sm"
              type="button"
              variant="secondary"
            >
              {m.accountReservationShowPinCode({}, { locale })}
            </Button>
          </Cell>
          <Cell caption="Current · reservation modal">
            <Button size="lg" type="button" variant="secondary">
              {m.checkoutEmailCustomerAccessButton({}, { locale })}
            </Button>
          </Cell>
          <Cell caption="Proposed · default (sm, account card)">
            <ReservationAccessButton
              className="@3xl:w-auto"
              href={accessHref}
              locale={locale}
            />
          </Cell>
          <Cell caption="Proposed · default (lg, reservation modal)">
            <ReservationAccessButton
              className="sm:w-auto"
              href={accessHref}
              locale={locale}
              navigation="client"
              size="lg"
            />
          </Cell>
          <Cell caption="Proposed · hover" state="hover">
            <ReservationAccessButton
              className="@3xl:w-auto"
              href={accessHref}
              locale={locale}
            />
          </Cell>
          <Cell caption="Proposed · focus-visible" state="focus-visible">
            <ReservationAccessButton
              className="@3xl:w-auto"
              href={accessHref}
              locale={locale}
            />
          </Cell>
        </div>
      </Board>
    )
  );
}
