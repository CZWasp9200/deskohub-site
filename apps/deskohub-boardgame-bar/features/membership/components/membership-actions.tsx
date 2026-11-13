"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { LocalizedLink, m } from "@/features/i18n";
import {
  cancelMembershipRequestAction,
  requestMembershipAction,
} from "@/features/membership/actions/membership";
import { Button } from "@/shared/components/ui/button";

const outcomeMessages = {
  requested: () => m["membership.outcome.requested"](),
  alreadyRequested: () => m["membership.outcome.alreadyRequested"](),
  planUnavailable: () => m["membership.outcome.planUnavailable"](),
  cancelled: () => m["membership.outcome.cancelled"](),
  signedOut: () => m["membership.outcome.signedOut"](),
};

function useOutcomeHandlers() {
  const router = useRouter();
  return {
    onSuccess: ({
      data,
    }: {
      data?: { outcome: keyof typeof outcomeMessages };
    }) => {
      if (!data) {
        toast.error(m["membership.outcome.failed"]());
        return;
      }
      const message = outcomeMessages[data.outcome]();
      if (data.outcome === "requested" || data.outcome === "cancelled") {
        toast.success(message);
      } else {
        toast.error(message);
      }
      router.refresh();
    },
    onError: () => {
      toast.error(m["membership.outcome.failed"]());
    },
  };
}

/**
 * The button under a plan. A signed-out visitor is sent to sign in first;
 * while another request waits for payment the button is disabled.
 */
export function RequestMembershipButton({
  planId,
  signedIn,
  signInHref,
  disabled,
}: {
  readonly planId: number;
  readonly signedIn: boolean;
  readonly signInHref: string;
  readonly disabled: boolean;
}) {
  const { execute, isExecuting } = useAction(
    requestMembershipAction,
    useOutcomeHandlers()
  );
  const buttonClass =
    "w-full bg-green-500 font-semibold text-gray-900 hover:bg-green-400";

  if (!signedIn) {
    return (
      <Button asChild className={buttonClass}>
        <LocalizedLink href={signInHref}>
          {m["membership.signInToRequest"]()}
        </LocalizedLink>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      disabled={disabled || isExecuting}
      onClick={() => execute({ planId })}
      className={buttonClass}
    >
      {isExecuting ? m["membership.requesting"]() : m["membership.request"]()}
    </Button>
  );
}

export function CancelMembershipRequestButton() {
  const { execute, isExecuting } = useAction(
    cancelMembershipRequestAction,
    useOutcomeHandlers()
  );

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isExecuting}
      onClick={() => execute()}
      className="border-gray-600 bg-transparent text-gray-200 hover:bg-gray-700 hover:text-white"
    >
      {m["membership.pending.cancel"]()}
    </Button>
  );
}
