"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { deleteAccount } from "@/features/account/actions/delete-account";
import { m } from "@/features/i18n";
import { getLocalizedHref } from "@/features/i18n/utils/locale-url";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { Button } from "@/shared/components/ui/button";

/**
 * Deletes the account after the customer ticks that they understand what
 * goes with it. A running membership is named, because it ends with the
 * account and isn't refunded.
 */
export function DeleteAccount({
  hasMembership,
}: {
  readonly hasMembership: boolean;
}) {
  const router = useRouter();
  const locale = useLocale();
  const confirmId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<
    "deleted" | "signInLinkSent" | "failed" | null
  >(null);

  const { execute, isExecuting } = useAction(deleteAccount, {
    onSuccess: ({ data }) => {
      setOutcome(data?.status ?? "failed");
      if (data?.status !== "deleted") return;
      router.push(getLocalizedHref("/", locale));
      router.refresh();
    },
    onError: () => setOutcome("failed"),
  });
  const busy = isExecuting || outcome === "deleted";

  return (
    <div className="rounded-md border border-red-400/30 p-4">
      <h3 className="font-medium text-white">{m["account.delete.title"]()}</h3>
      <p className="mt-1 text-sm text-gray-300">{m["account.delete.body"]()}</p>
      {hasMembership && (
        <p className="mt-2 text-sm text-amber-200">
          {m["account.delete.membershipWarning"]()}
        </p>
      )}
      <label
        htmlFor={confirmId}
        className="mt-3 flex items-start gap-2 text-sm text-gray-200"
      >
        <input
          id={confirmId}
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 size-4 accent-red-500"
        />
        {m["account.delete.confirm"]()}
      </label>
      <Button
        type="button"
        variant="outline"
        disabled={!confirmed || busy}
        onClick={() => {
          setOutcome(null);
          execute({
            confirmed: true,
            returnPath: getLocalizedHref("/account", locale),
          });
        }}
        className="mt-4 border-red-400/60 bg-transparent text-red-300 hover:bg-red-500/10 hover:text-red-200"
      >
        {busy ? m["account.delete.deleting"]() : m["account.delete.submit"]()}
      </Button>
      <p role="alert" className="mt-2 text-sm text-red-400 empty:mt-0">
        {outcome === "failed" ? m["account.delete.failed"]() : null}
      </p>
      <p role="status" className="mt-2 text-sm text-gray-200 empty:mt-0">
        {outcome === "signInLinkSent"
          ? m["account.delete.signInLinkSent"]()
          : null}
      </p>
    </div>
  );
}
