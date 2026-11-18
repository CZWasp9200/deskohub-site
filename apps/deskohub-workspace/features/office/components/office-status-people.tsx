"use client";

import Interpolate from "@doist/react-interpolate";
import { Check, Mail } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { textLink } from "@/shared/components/ui/text-link";

/** An invited person on a booked office, as its booker sees them. */
export type OfficeStatusInvitee = {
  readonly id: string;
  readonly email: string;
  /** When the booker may send the invitation again; absent when they may now. */
  readonly resendAvailableAt?: Temporal.Instant;
};

/** Who is coming to a booked office, as its booker's status page lists them. */
export type OfficeStatusPeople = {
  readonly contactAttends: boolean;
  readonly invitees: ReadonlyArray<OfficeStatusInvitee>;
};

/** What sending an invitation again did. */
export type OfficeInvitationResend =
  | { readonly status: "sent"; readonly resendAvailableAt?: Temporal.Instant }
  | { readonly status: "cooldown"; readonly retryAt?: Temporal.Instant }
  | { readonly status: "failed" };

/** Sends one invitee their invitation again. */
export type ResendOfficeInvitation = (input: {
  readonly orderId: string;
  readonly inviteeId: string;
}) => Promise<OfficeInvitationResend>;

type OfficeStatusPeopleListProps = {
  /** The reservation's contact, listed first while they attend. */
  readonly contact?: { readonly name?: string; readonly email?: string };
  /** The prefilled contact page for asking staff to change the list. */
  readonly changeHref: string;
  readonly locale: Locale;
  readonly orderId: string;
  readonly people: OfficeStatusPeople;
  /** Left out where the page can't send invitations. */
  readonly resendInvitation?: ResendOfficeInvitation;
};

/**
 * The people a booked office invited, each with a way to send their
 * invitation again, and how to change the list, which only staff can.
 */
export function OfficeStatusPeopleList({
  changeHref,
  contact,
  locale,
  orderId,
  people,
  resendInvitation,
}: OfficeStatusPeopleListProps) {
  return (
    <div className="font-normal" data-office-status-people="">
      <ul className="divide-y divide-navy-blue/10">
        {people.contactAttends && (
          <li className="pb-3">
            <span className="block font-semibold text-navy-blue">
              {contact?.name
                ? m.checkoutStatusPeopleContact(
                    { name: contact.name },
                    { locale }
                  )
                : m.officePeopleYou({}, { locale })}
            </span>
            {contact?.email && (
              <span className="block break-all text-sm text-navy-blue/70">
                {contact.email}
              </span>
            )}
          </li>
        )}
        {people.invitees.map((invitee) => (
          <OfficeStatusInviteeRow
            invitee={invitee}
            key={invitee.id}
            locale={locale}
            orderId={orderId}
            resendInvitation={resendInvitation}
          />
        ))}
      </ul>
      <p className="mt-3 text-sm leading-6 text-navy-blue/64">
        <Interpolate
          string={m.checkoutStatusPeopleChangeNote({}, { locale })}
          mapping={{
            link: (label) => (
              <Link
                className={textLink({ tone: "inherit" })}
                href={changeHref}
                prefetch={false}
              >
                {label}
              </Link>
            ),
          }}
        />
      </p>
    </div>
  );
}

type InviteeResendState = "idle" | "sending" | "sent" | "failed";

function OfficeStatusInviteeRow({
  invitee,
  locale,
  orderId,
  resendInvitation,
}: {
  readonly invitee: OfficeStatusInvitee;
  readonly locale: Locale;
  readonly orderId: string;
  readonly resendInvitation?: ResendOfficeInvitation;
}) {
  const [state, setState] = useState<InviteeResendState>("idle");
  const [availableAt, setAvailableAt] = useState(invitee.resendAvailableAt);
  const coolingDown = useCoolingDown(availableAt);

  const resend = async () => {
    if (!resendInvitation) return;
    setState("sending");
    const outcome = await resendInvitation({ orderId, inviteeId: invitee.id });
    if (outcome.status === "sent") {
      setAvailableAt(outcome.resendAvailableAt);
      setState("sent");
      return;
    }
    if (outcome.status === "cooldown") setAvailableAt(outcome.retryAt);
    setState(outcome.status === "cooldown" ? "idle" : "failed");
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 last:pb-0">
      <span className="min-w-0 break-all font-semibold text-navy-blue">
        {invitee.email}
      </span>
      {resendInvitation && (
        <span className="shrink-0">
          {state === "sent" ? (
            <span className="inline-flex h-9 items-center gap-2 rounded-full border border-aquamarine-green/40 bg-aquamarine-green/12 px-4 text-xs font-semibold uppercase tracking-[0.08em] text-aquamarine-ink">
              <Check aria-hidden="true" className="size-4" />
              {m.checkoutStatusPeopleSent({}, { locale })}
            </span>
          ) : (
            <Button
              aria-label={m.checkoutStatusPeopleResendLabel(
                { email: invitee.email },
                { locale }
              )}
              caps
              disabled={coolingDown || state === "sending"}
              onClick={() => void resend()}
              pending={state === "sending"}
              shape="pill"
              size="sm"
              type="button"
              variant="secondary"
            >
              <Mail aria-hidden="true" className="size-4" />
              {m.checkoutStatusPeopleResend({}, { locale })}
            </Button>
          )}
        </span>
      )}
      <span className="sr-only" role="status">
        {state === "sent" &&
          m.checkoutStatusPeopleSentAnnouncement(
            { email: invitee.email },
            { locale }
          )}
      </span>
      {state === "failed" && (
        <span
          className="basis-full text-sm font-medium text-burned-orange-ink"
          role="alert"
        >
          {m.checkoutStatusPeopleResendFailed({}, { locale })}
        </span>
      )}
    </li>
  );
}

/**
 * Whether `availableAt` is still ahead, turning false once it passes. It
 * reads the clock only after hydration, so the server and the first client
 * render agree.
 */
function useCoolingDown(availableAt: Temporal.Instant | undefined) {
  const until = availableAt?.epochMilliseconds;
  const [passedUntil, setPassedUntil] = useState<number>();

  useEffect(() => {
    if (until === undefined) return;
    const timer = setTimeout(
      () => setPassedUntil(until),
      Math.max(0, until - Date.now())
    );
    return () => clearTimeout(timer);
  }, [until]);

  return until !== undefined && passedUntil !== until;
}
