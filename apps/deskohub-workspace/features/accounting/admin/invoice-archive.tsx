"use client";

import type { AdministrationInvoiceIdType } from "@deskohub/workspace-admin-api";
import { EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/features/administration/confirm-dialog";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import { Button } from "@/shared/components/ui/button";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { archiveAdministrationInvoice } from "./actions";

/**
 * Hides a cancelled invoice from the Admin UI after a confirmation. The Admin
 * UI has no way to show it again, so the detail page returns to the list.
 */
export function InvoiceArchive({
  invoiceId,
  invoiceNumber,
  placement,
}: {
  readonly invoiceId: AdministrationInvoiceIdType;
  readonly invoiceNumber: string;
  /** A list row's icon button, or the detail page's labelled button. */
  readonly placement: "row" | "detail";
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(
    archiveAdministrationInvoice,
    {
      onSuccess: () => {
        setOpen(false);
        if (placement === "detail") {
          router.push(getLocalizedPagePath(locale, "/[locale]/admin/invoices"));
        } else {
          router.refresh();
        }
      },
      onError: ({ error: actionError }) =>
        setError(
          actionError.serverError ??
            m.accountingInvoiceHideFailed({}, { locale })
        ),
      onTransportError: () =>
        setError(m.accountingInvoiceHideFailed({}, { locale })),
    }
  );
  return (
    <ConfirmDialog
      confirmLabel={m.accountingInvoiceHideConfirm({}, { locale })}
      description={m.accountingInvoiceHideDescription(
        { invoiceNumber },
        { locale }
      )}
      error={error}
      onConfirm={() => {
        setError(null);
        execute({ invoiceId });
      }}
      onOpenChange={(nextOpen) => {
        setError(null);
        setOpen(nextOpen);
      }}
      open={open}
      pending={isExecuting}
      title={m.accountingInvoiceHideTitle({ invoiceNumber }, { locale })}
      trigger={
        placement === "row" ? (
          <Button
            aria-label={m.accountingInvoiceHideLabel(
              { invoiceNumber },
              { locale }
            )}
            size="icon"
            type="button"
            variant="ghost"
          >
            <EyeOff aria-hidden className="size-4" />
          </Button>
        ) : (
          <Button type="button" variant="secondary">
            <EyeOff aria-hidden className="size-4" />{" "}
            {m.accountingInvoiceHideOpen({}, { locale })}
          </Button>
        )
      }
    />
  );
}
