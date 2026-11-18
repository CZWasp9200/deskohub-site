import { Mail } from "lucide-react";
import { useId } from "react";
import { type Locale, m } from "@/features/i18n";
import {
  getOfficePeopleSeats,
  type OfficePeople,
} from "@/features/office/office-people";
import { breakEmail, getInitials, OfficePersonRow } from "./office-person-row";

/** Who is coming to the office an order books, as the Pay page reviews it. */
export type OfficeCheckoutPeople = OfficePeople & {
  /** The reservation's contact, the "You" row while they attend. */
  readonly contact: { readonly name: string; readonly email: string };
  /** The office's seats, for the "2 of 6" count; left out when unknown. */
  readonly seatCapacity?: number;
};

/** The people an office order invites, reviewed before payment. */
export function OfficeCheckoutPeopleReview({
  locale,
  people,
}: {
  readonly locale: Locale;
  readonly people: OfficeCheckoutPeople;
}) {
  const titleId = useId();

  return (
    <div className="space-y-3" data-office-checkout-people="">
      <div className="overflow-hidden rounded-2xl border border-navy-blue/10 bg-white">
        <div className="flex items-baseline justify-between gap-3 border-b border-navy-blue/10 p-4">
          <h2
            className="text-sm font-semibold uppercase tracking-[0.12em] text-navy-blue/58"
            id={titleId}
          >
            {m.checkoutPeopleTitle({}, { locale })}
          </h2>
          {people.seatCapacity !== undefined && (
            <span className="text-sm font-semibold tabular-nums text-navy-blue/58">
              {m.officePeopleCount(
                {
                  count: getOfficePeopleSeats(people),
                  maximum: people.seatCapacity,
                },
                { locale }
              )}
            </span>
          )}
        </div>
        <ul aria-labelledby={titleId} className="divide-y divide-navy-blue/10">
          {people.contactAttends && (
            <OfficePersonRow
              avatar={getInitials(people.contact.name)}
              contactRow
              tag={m.officePeopleYou({}, { locale })}
            >
              <span className="block font-semibold text-navy-blue">
                {people.contact.name}
              </span>
              <span className="block text-sm text-navy-blue/70">
                {breakEmail(people.contact.email)}
              </span>
            </OfficePersonRow>
          )}
          {people.invitees.map((invitee) => (
            <OfficePersonRow
              avatar={invitee.charAt(0).toUpperCase()}
              key={invitee}
            >
              <span className="block text-navy-blue">
                {breakEmail(invitee)}
              </span>
            </OfficePersonRow>
          ))}
        </ul>
      </div>
      <p className="flex items-start gap-2 text-sm leading-6 text-navy-blue/66">
        <Mail aria-hidden="true" className="mt-1 size-4 shrink-0" />
        {m.checkoutPeopleNote({}, { locale })}
      </p>
    </div>
  );
}
