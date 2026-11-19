import { Option } from "effect";
import Mail from "lucide-react-native/icons/mail";
import Plus from "lucide-react-native/icons/plus";
import X from "lucide-react-native/icons/x";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { Button, TextField } from "../../ui/controls";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/icon-button";
import { ListGroup } from "../../ui/list";
import { listRowLayout } from "../../ui/list-row-layout";
import { PersonRow } from "../../ui/person-row";
import { Text } from "../../ui/text";
import { color, space } from "../../ui/tokens";
import {
  addOfficePerson,
  addYou,
  canAddOfficePerson,
  canRemoveOfficePerson,
  type OfficePeople,
  officePeopleCount,
  removeInvitee,
  removeYou,
} from "../selection/office-people";
import type { OfficeContact } from "./office-booking-model";

/**
 * Who is coming on the office's Choose step: You and the invited people,
 * each removable while someone else stays, the address field and Add while
 * a seat is free, "Add yourself" once You is off the list, and that
 * everyone gets the door PIN by email.
 */
export function OfficePeopleList({
  people,
  contact,
  maximumSeats,
  onChange,
  locale,
}: {
  readonly people: OfficePeople;
  /** None while the account can't be read: no You row, and no Add yourself. */
  readonly contact: Option.Option<OfficeContact>;
  readonly maximumSeats: Option.Option<number>;
  readonly onChange: (people: OfficePeople) => void;
  readonly locale: AppLocale;
}) {
  const [typed, setTyped] = useState("");
  const [invalid, setInvalid] = useState(false);
  const removable = canRemoveOfficePerson(people);
  const roomLeft = canAddOfficePerson(people, maximumSeats);
  const you = Option.getOrUndefined(contact);
  const add = () => {
    const addition = addOfficePerson(people, typed, {
      contactEmail: Option.map(contact, ({ email }) => email),
      maximumSeats,
    });
    setInvalid(addition._tag === "Invalid");
    if (addition._tag === "Added") onChange(addition.people);
    if (addition._tag === "Added" || addition._tag === "Listed") setTyped("");
  };
  const removeButton = (label: string, onPress: () => void) => (
    <IconButton
      icon={X}
      label={label}
      onPress={onPress}
      disabled={!removable}
    />
  );
  return (
    <View style={styles.stack}>
      <ListGroup>
        {people.contactAttends && you !== undefined && (
          <PersonRow
            key="you"
            email={you.email}
            {...(you.name !== undefined && { name: you.name })}
            you={m.booking_office_person_you({}, { locale })}
            action={removeButton(
              m.booking_office_person_remove_you({}, { locale }),
              () => onChange(removeYou(people))
            )}
          />
        )}
        {people.invitees.map((email) => (
          <PersonRow
            key={email}
            email={email}
            action={removeButton(
              m.booking_office_person_remove({ email }, { locale }),
              () => onChange(removeInvitee(people, email))
            )}
          />
        ))}
        {roomLeft ? (
          <View key="add" style={[listRowLayout.row, styles.addRow]}>
            <TextField
              label={m.booking_office_person_email_label({}, { locale })}
              labelHidden
              placeholder={m.booking_office_person_email_label({}, { locale })}
              value={typed}
              onChangeText={(text) => {
                setTyped(text);
                setInvalid(false);
              }}
              onSubmitEditing={add}
              keyboardType="email-address"
              inputMode="email"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="done"
              maxLength={255}
              error={
                invalid
                  ? m.booking_office_person_email_invalid({}, { locale })
                  : undefined
              }
              accessory={
                <Button
                  variant="secondary"
                  icon={Plus}
                  width="content"
                  label={m.booking_office_person_add({}, { locale })}
                  onPress={add}
                />
              }
            />
            {!people.contactAttends && you !== undefined && (
              <View style={styles.addYourself}>
                <Button
                  variant="text"
                  icon={Plus}
                  width="content"
                  size="small"
                  label={m.booking_office_person_add_yourself({}, { locale })}
                  onPress={() => onChange(addYou(people, maximumSeats))}
                />
              </View>
            )}
          </View>
        ) : (
          <View key="full" style={listRowLayout.row}>
            <Text variant="bodySmall" tone="muted" style={listRowLayout.text}>
              {m.booking_office_people_full(
                { count: officePeopleCount(people) },
                { locale }
              )}
            </Text>
          </View>
        )}
      </ListGroup>
      <View style={styles.note}>
        <Icon icon={Mail} size={16} color={color.ink2} />
        <Text variant="hint" style={styles.noteText}>
          {m.booking_office_people_pin_note({}, { locale })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  addRow: { alignItems: "stretch", flexDirection: "column", gap: space.sm },
  addYourself: { alignSelf: "flex-start" },
  note: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.xs,
  },
  noteText: { flexShrink: 1 },
});
