import type {
  CustomerOrderState,
  CustomerReservationInviteeId,
  CustomerReservationPeople,
} from "@deskohub/workspace-customer-api";
import Interpolate from "@doist/react-interpolate";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { DateTime, Exit, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import CircleUserRound from "lucide-react-native/icons/circle-user-round";
import { type ReactNode, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  type OfficeContact,
  officeContactOf,
} from "../../booking/family/office-booking-model";
import { BookingSectionHeading } from "../../booking/ui/booking-section-heading";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { viewErrorOf } from "../../customer-api/customer-view-error";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { openContactPage } from "../../routing/open-contact-page";
import { Button } from "../../ui/controls";
import { Icon } from "../../ui/icon";
import { ListGroup } from "../../ui/list";
import { PersonRow } from "../../ui/person-row";
import { Text } from "../../ui/text";
import { useToast } from "../../ui/toast";
import { color, space } from "../../ui/tokens";
import { accessWindowOf } from "./access-window";
import {
  AccessWindowSpan,
  accessDaysText,
  accessWindowSpanOf,
} from "./access-window-text";
import { shortDate } from "./booking-ticket-text";
import { inviteeResend, resendInvitationAtom } from "./order-people";

/** The booking's day or days, as the change request names them. */
const bookedDaysText = (order: CustomerOrderState, locale: AppLocale) =>
  Option.getOrUndefined(
    Option.map(
      accessWindowOf({
        accessStartsAt: order.startsAt ?? "",
        accessEndsAt: order.endsAt ?? "",
      }),
      (window) =>
        AccessWindowSpan.$match(accessWindowSpanOf(window), {
          Days: ({ first, last }) => accessDaysText(first, last, locale),
          Times: ({ from }) => shortDate(from, locale),
        })
    )
  ) ?? "";

/**
 * Who is coming to a booked office: You while attending, then the invited
 * people, each with Resend once their invitation went out, and how to
 * change the list: the contact form, filled in with the change request.
 */
export function OrderPeopleSection({
  order,
  people,
}: {
  readonly order: CustomerOrderState;
  readonly people: CustomerReservationPeople;
}) {
  const locale = useAppLocale();
  const toast = useToast();
  const contact: Option.Option<OfficeContact> = Option.flatMap(
    AsyncResult.value(useAtomValue(accountAtom)),
    officeContactOf
  );
  const resend = useAtomSet(resendInvitationAtom(order.orderId), {
    mode: "promiseExit",
  });
  const [resentUntil, setResentUntil] = useState<
    Readonly<Record<string, string>>
  >({});
  const [sending, setSending] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [now, setNow] = useState(() => DateTime.nowUnsafe());

  const rows = people.invitees.map((invitee) => ({
    invitee,
    resend: inviteeResend(
      invitee,
      Option.fromUndefinedOr(resentUntil[invitee.id]),
      now
    ),
  }));
  // Resend comes back on its own once the earliest wait is over.
  const nextOpening = rows
    .flatMap(({ resend: offered }) =>
      Option.toArray(Option.flatMap(offered, ({ opensAt }) => opensAt))
    )
    .map(DateTime.toEpochMillis)
    .sort((a, b) => a - b)[0];
  useEffect(() => {
    if (nextOpening === undefined) return;
    const timer = setTimeout(
      () => setNow(DateTime.nowUnsafe()),
      Math.max(0, nextOpening - Date.now()) + 250
    );
    return () => clearTimeout(timer);
  }, [nextOpening]);

  const send = async (
    inviteeId: CustomerReservationInviteeId,
    email: string
  ) => {
    setSending(inviteeId);
    setFailure(undefined);
    const exit = await resend(inviteeId);
    setSending(undefined);
    setNow(DateTime.nowUnsafe());
    if (Exit.isFailure(exit)) {
      setFailure(
        sharedViewErrorMessage(viewErrorOf(exit.cause), locale) ??
          m.account_error_unexpected({}, { locale })
      );
      return;
    }
    const answer = exit.value;
    if (answer._tag === "Sent") {
      setResentUntil((held) => ({ ...held, [inviteeId]: answer.availableAt }));
      toast.show({
        message: m.reservations_people_resent({ email }, { locale }),
        tone: "confirmation",
      });
      return;
    }
    if (answer._tag === "TooSoon" && Option.isSome(answer.retryAt)) {
      const retryAt = answer.retryAt.value;
      setResentUntil((held) => ({ ...held, [inviteeId]: retryAt }));
    }
    setFailure(
      answer._tag === "TooSoon"
        ? m.reservations_people_resend_later({}, { locale })
        : m.account_error_unexpected({}, { locale })
    );
  };

  const you = Option.getOrUndefined(contact);
  const changeRequest = () =>
    openContactPage({
      ...(you?.name !== undefined && { name: you.name }),
      ...(you !== undefined && { email: you.email }),
      message: m.reservations_people_change_message(
        { reference: order.orderId, date: bookedDaysText(order, locale) },
        { locale }
      ),
    });
  const contactLink = (label: ReactNode) => (
    <Text role="link" style={styles.link} onPress={changeRequest}>
      {label}
    </Text>
  );

  return (
    <View>
      <BookingSectionHeading
        title={m.booking_office_people_who_is_coming({}, { locale })}
      />
      <View style={styles.stack}>
        <ListGroup>
          {people.contactAttends && you !== undefined && (
            <PersonRow
              key="you"
              email={you.email}
              {...(you.name !== undefined && { name: you.name })}
              you={m.booking_office_person_you({}, { locale })}
            />
          )}
          {rows.map(({ invitee, resend: offered }) => (
            <PersonRow
              key={invitee.id}
              email={invitee.email}
              action={Option.getOrUndefined(
                Option.map(offered, ({ opensAt }) => (
                  <Button
                    variant="text"
                    size="small"
                    width="content"
                    label={m.reservations_people_resend({}, { locale })}
                    accessibilityLabel={m.reservations_people_resend_to(
                      { email: invitee.email },
                      { locale }
                    )}
                    busy={sending === invitee.id}
                    disabled={sending !== undefined || Option.isSome(opensAt)}
                    onPress={() => void send(invitee.id, invitee.email)}
                  />
                ))
              )}
            />
          ))}
        </ListGroup>
        {failure !== undefined && (
          <Text variant="hint" tone="danger" role="alert">
            {failure}
          </Text>
        )}
        <View style={styles.note}>
          <Icon icon={CircleUserRound} size={16} color={color.ink2} />
          <Text variant="hint" style={styles.noteText}>
            <Interpolate
              string={m.reservations_people_change({}, { locale })}
              mapping={{ contact: contactLink }}
            />
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  note: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.xs,
  },
  noteText: { flexShrink: 1 },
  // The link keeps the sentence's font and colour; only the underline marks it.
  link: { textDecorationLine: "underline" },
});
