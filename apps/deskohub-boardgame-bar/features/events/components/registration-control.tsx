"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  cancelEventRegistrationAction,
  registerForEventAction,
} from "@/features/events/actions/registration";
import { LocalizedLink, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

/** What the visitor can do about one event right now. */
export type RegistrationAvailability =
  | "signedOut"
  | "registered"
  | "open"
  | "full"
  | "closed"
  | "past";

const outcomeMessages = {
  registered: () => m["events.outcome.registered"](),
  alreadyRegistered: () => m["events.outcome.alreadyRegistered"](),
  full: () => m["events.outcome.full"](),
  closed: () => m["events.outcome.closed"](),
  notFound: () => m["events.outcome.notFound"](),
  cancelled: () => m["events.outcome.cancelled"](),
  signedOut: () => m["events.outcome.signedOut"](),
};

export function RegistrationControl({
  eventId,
  availability,
  signInHref,
}: {
  readonly eventId: number;
  readonly availability: RegistrationAvailability;
  readonly signInHref: string;
}) {
  const router = useRouter();

  const handlers = {
    onSuccess: ({
      data,
    }: {
      data?: { outcome: keyof typeof outcomeMessages };
    }) => {
      if (!data) {
        toast.error(m["events.outcome.failed"]());
        return;
      }
      const message = outcomeMessages[data.outcome]();
      if (data.outcome === "registered" || data.outcome === "cancelled") {
        toast.success(message);
      } else {
        toast.error(message);
      }
      // The counts and buttons come from the server; reload them.
      router.refresh();
    },
    onError: () => {
      toast.error(m["events.outcome.failed"]());
    },
  };
  const register = useAction(registerForEventAction, handlers);
  const cancel = useAction(cancelEventRegistrationAction, handlers);

  const noteClass = "text-sm font-medium text-gray-400";

  switch (availability) {
    case "past":
      return <p className={noteClass}>{m["events.past"]()}</p>;
    case "closed":
      return <p className={noteClass}>{m["events.closed"]()}</p>;
    case "full":
      return <p className={noteClass}>{m["events.full"]()}</p>;
    case "signedOut":
      return (
        <div>
          <Button
            asChild
            variant="outline"
            className="border-green-500 bg-transparent text-green-400 hover:bg-green-500/10 hover:text-green-300"
          >
            <LocalizedLink href={signInHref}>
              {m["events.signInToRegister"]()}
            </LocalizedLink>
          </Button>
          <p className="mt-2 text-xs text-gray-400">
            {m["events.signInHint"]()}
          </p>
        </div>
      );
    case "registered":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-1.5 font-medium text-green-400">
            <Check className="h-4 w-4" aria-hidden />
            {m["events.youAreRegistered"]()}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cancel.isExecuting}
            onClick={() => cancel.execute({ eventId })}
            className="border-gray-600 bg-transparent text-gray-200 hover:bg-gray-700 hover:text-white"
          >
            {m["events.cancel"]()}
          </Button>
        </div>
      );
    case "open":
      return (
        <Button
          type="button"
          disabled={register.isExecuting}
          onClick={() => register.execute({ eventId })}
          className="bg-green-500 font-semibold text-gray-900 hover:bg-green-400"
        >
          {register.isExecuting
            ? m["events.registering"]()
            : m["events.register"]()}
        </Button>
      );
  }
}
