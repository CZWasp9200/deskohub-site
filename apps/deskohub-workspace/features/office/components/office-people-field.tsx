"use client";

import { Result } from "effect";
import { Mail, Plus, UserRound } from "lucide-react";
import { type KeyboardEvent, type Ref, useId, useState } from "react";
import { type Locale, m } from "@/features/i18n";
import {
  canAddOfficePerson,
  getOfficePeopleSeats,
  type OfficePeople,
} from "@/features/office/office-people";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { UnstyledButton } from "@/shared/components/ui/unstyled-button";
import {
  addOfficeInvitee,
  canRemoveOfficePerson,
  type OfficeInviteeAdditionRejection,
  removeOfficeContact,
  removeOfficeInvitee,
  restoreOfficeContact,
} from "./office-people-editing";
import { breakEmail, getInitials, OfficePersonRow } from "./office-person-row";

/** The reservation's contact as the form knows them so far. */
export type OfficePeopleContact = {
  readonly name: string;
  readonly email: string;
};

type OfficePeopleFieldProps = {
  readonly people: OfficePeople;
  readonly onChange: (people: OfficePeople) => void;
  /** The contact once the form knows their email, for the "You" row and the contact check. */
  readonly contact?: OfficePeopleContact;
  /** A list-level problem the form reports, such as an over-full office. */
  readonly error?: string;
  /** Receives the address input, which the form focuses on a people error. */
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly labelId: string;
  readonly locale: Locale;
  readonly seatCapacity: number;
};

/**
 * Who is coming to a private office: the contact's "You" row while they
 * attend, the people added by email address, and the address input. Each
 * person takes one seat, up to the office's `seatCapacity`.
 */
export function OfficePeopleField({
  people,
  onChange,
  contact,
  error,
  inputRef,
  labelId,
  locale,
  seatCapacity,
}: OfficePeopleFieldProps) {
  const [candidate, setCandidate] = useState("");
  const [rejection, setRejection] = useState<OfficeInviteeAdditionRejection>();
  const inputId = useId();
  const errorId = useId();
  const contactEmail = contact?.email.trim().toLowerCase() || undefined;
  const removable = canRemoveOfficePerson(people);
  const hasRoom = canAddOfficePerson(people, seatCapacity);

  const add = () => {
    const added = addOfficeInvitee(people, candidate, {
      seatCapacity,
      contactEmail,
    });
    if (Result.isFailure(added)) {
      setRejection(added.failure);
      return;
    }
    setRejection(undefined);
    setCandidate("");
    onChange(added.success);
  };
  const addOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    // Enter adds the address instead of submitting the whole booking form.
    event.preventDefault();
    add();
  };
  const rejectionMessage =
    rejection &&
    {
      invalid: m.officePeopleInvalidEmail({}, { locale }),
      duplicate: m.officePeopleDuplicateEmail({}, { locale }),
      contact: m.officePeopleContactEmail({}, { locale }),
      full: m.officePeopleFull({ maximum: seatCapacity }, { locale }),
    }[rejection];

  return (
    <div className="flex flex-col gap-2" data-office-people="">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72 after:content-['_*']"
          id={labelId}
        >
          {m.officePeopleLabel({}, { locale })}
        </span>
        <span
          className="text-sm font-semibold tabular-nums text-navy-blue/72"
          data-office-people-count=""
        >
          {m.officePeopleCount(
            { count: getOfficePeopleSeats(people), maximum: seatCapacity },
            { locale }
          )}
        </span>
      </div>

      <div className="overflow-hidden rounded-[1.4rem] border border-navy-blue/10 bg-white">
        <ul aria-labelledby={labelId} className="divide-y divide-navy-blue/10">
          {people.contactAttends && (
            <OfficePersonRow
              avatar={
                contact?.name ? (
                  getInitials(contact.name)
                ) : (
                  <UserRound aria-hidden="true" className="size-5" />
                )
              }
              contactRow
              removeLabel={m.officePeopleRemoveYourself({}, { locale })}
              onRemove={
                removable
                  ? () => onChange(removeOfficeContact(people))
                  : undefined
              }
              tag={contactEmail ? m.officePeopleYou({}, { locale }) : undefined}
            >
              <span className="block font-semibold text-navy-blue">
                {contactEmail && contact?.name
                  ? contact.name
                  : m.officePeopleYou({}, { locale })}
              </span>
              <span className="block text-sm text-navy-blue/70">
                {contactEmail
                  ? breakEmail(contactEmail)
                  : m.officePeopleContactEmailLater({}, { locale })}
              </span>
            </OfficePersonRow>
          )}
          {people.invitees.map((invitee) => {
            const isContact = invitee === contactEmail;
            return (
              <OfficePersonRow
                avatar={invitee.charAt(0).toUpperCase()}
                key={invitee}
                onRemove={
                  removable
                    ? () => onChange(removeOfficeInvitee(people, invitee))
                    : undefined
                }
                removeLabel={m.officePeopleRemove(
                  { email: invitee },
                  { locale }
                )}
              >
                <span className="block text-navy-blue">
                  {breakEmail(invitee)}
                </span>
                {isContact && (
                  <span
                    className="mt-1 block text-sm font-medium text-burned-orange-ink"
                    data-office-person-error=""
                  >
                    {m.officePeopleContactEmail({}, { locale })}
                  </span>
                )}
              </OfficePersonRow>
            );
          })}
        </ul>

        <div className="border-t border-navy-blue/10 p-4 sm:px-6">
          {hasRoom ? (
            <>
              <div className="flex gap-3">
                <label className="sr-only" htmlFor={inputId}>
                  {m.officePeopleEmailLabel({}, { locale })}
                </label>
                <Input
                  aria-describedby={rejectionMessage ? errorId : undefined}
                  aria-invalid={rejectionMessage ? true : undefined}
                  autoComplete="off"
                  className="min-w-0 flex-1"
                  data-office-invitee-email=""
                  id={inputId}
                  inputMode="email"
                  onChange={(event) => {
                    setCandidate(event.target.value);
                    setRejection(undefined);
                  }}
                  onKeyDown={addOnEnter}
                  placeholder={m.officePeopleEmailLabel({}, { locale })}
                  ref={inputRef}
                  type="email"
                  value={candidate}
                  variant={rejectionMessage ? "error" : "default"}
                />
                <Button
                  caps
                  className="shrink-0"
                  data-office-invitee-add=""
                  onClick={add}
                  shape="pill"
                  size="lg"
                  type="button"
                  variant="secondary"
                >
                  <Plus aria-hidden="true" className="size-4" />
                  {m.officePeopleAdd({}, { locale })}
                </Button>
              </div>
              <p
                className="mt-2 text-sm font-medium text-burned-orange-ink empty:hidden"
                id={errorId}
                role="alert"
              >
                {rejectionMessage}
              </p>
            </>
          ) : (
            <p className="text-navy-blue/72" data-office-people-full="">
              {m.officePeopleFull({ maximum: seatCapacity }, { locale })}
            </p>
          )}
          {!people.contactAttends && hasRoom && (
            <UnstyledButton
              className="mt-3 inline-flex items-center gap-2 font-semibold text-burned-orange-ink hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-burned-orange"
              onClick={() => onChange(restoreOfficeContact(people))}
            >
              <Plus aria-hidden="true" className="size-4" />
              {m.officePeopleAddYourself({}, { locale })}
            </UnstyledButton>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm font-medium text-burned-orange-ink" role="alert">
          {error}
        </p>
      )}
      <p className="flex items-start gap-2 text-navy-blue/72">
        <Mail aria-hidden="true" className="mt-1 size-4 shrink-0" />
        {m.officePeopleNote({}, { locale })}
      </p>
    </div>
  );
}
