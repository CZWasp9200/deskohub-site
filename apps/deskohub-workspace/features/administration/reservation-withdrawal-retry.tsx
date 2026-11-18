"use client";

import type {
  AdministrationWithdrawalRetryResultType,
  AdministrationWorkspaceReservationIdType,
} from "@deskohub/workspace-admin-api";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import type { Locale } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { settleAdministrationReservationWithdrawal } from "./actions";
import { m } from "./i18n";
import { AdministrationAlert } from "./notice";

const outcomeMessage = {
  settled: m.administrationWithdrawalRetrySettled,
  failed: m.administrationWithdrawalRetryFailed,
  in_progress: m.administrationWithdrawalRetryInProgress,
  already_settled: m.administrationWithdrawalRetryAlreadySettled,
} satisfies Record<
  AdministrationWithdrawalRetryResultType["outcome"],
  typeof m.administrationWithdrawalRetrySettled
>;

/**
 * Runs the withdrawal's settlement now, once an administrator fixed what made
 * a step fail, and says how the run went.
 */
export function ReservationWithdrawalRetry({
  children,
  locale,
  reservationId,
}: {
  readonly children: ReactNode;
  readonly locale: Locale;
  readonly reservationId: AdministrationWorkspaceReservationIdType;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(
    settleAdministrationReservationWithdrawal,
    {
      onSuccess: ({ data }) => {
        if (!data) return;
        setMessage(outcomeMessage[data.outcome]({}, { locale }));
        router.refresh();
      },
      onError: ({ error }) =>
        setMessage(
          error.serverError ??
            m.administrationWithdrawalRetryUnavailable({}, { locale })
        ),
      onTransportError: () =>
        setMessage(m.administrationWithdrawalRetryInterrupted({}, { locale })),
    }
  );

  return (
    <>
      {children && (
        <AdministrationAlert className="mt-4" status="error">
          {children}
          <Button
            aria-busy={isExecuting || undefined}
            className="mt-3"
            disabled={isExecuting}
            onClick={() => {
              setMessage(null);
              execute({ reservationId });
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            {isExecuting
              ? m.administrationWithdrawalRetrying({}, { locale })
              : m.administrationWithdrawalRetry({}, { locale })}
          </Button>
        </AdministrationAlert>
      )}
      <p
        className={message ? "mt-3 text-sm font-semibold" : "sr-only"}
        role="status"
      >
        {message}
      </p>
    </>
  );
}
