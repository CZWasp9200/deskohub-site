import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Badge } from "./badge";
import { emailWithBreak } from "./email-with-break";
import { listRowLayout } from "./list-row-layout";
import { Text } from "./text";
import { color } from "./tokens";

const discSize = 40;

/**
 * The letters a person's disc shows: the first letters of the first and
 * last words of their name, else the first letter of their email address.
 */
export const personInitials = (person: {
  readonly name?: string;
  readonly email: string;
}): string => {
  const words = (person.name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) {
    return person.email.trim().charAt(0).toLocaleUpperCase();
  }
  const last = words.length > 1 ? (words[words.length - 1] ?? "") : "";
  return `${first.charAt(0)}${last.charAt(0)}`.toLocaleUpperCase();
};

/**
 * A person in a `ListGroup`, such as who is coming to an office: a disc
 * with their initials, their name over their email address (or the address
 * alone), the You tag for the customer, and an action at the end, such as
 * remove or Resend.
 */
export function PersonRow({
  email,
  name,
  you,
  action,
}: {
  readonly email: string;
  readonly name?: string;
  /** The You tag's label: this person is the customer, on a navy disc. */
  readonly you?: string;
  readonly action?: ReactNode;
}) {
  const initials = personInitials({ email, ...(name && { name }) });
  return (
    <View style={listRowLayout.row}>
      <View
        aria-hidden
        style={[styles.disc, you === undefined ? styles.other : styles.you]}
      >
        <Text
          variant="label"
          style={{ color: you === undefined ? color.navy : color.white }}
        >
          {initials}
        </Text>
      </View>
      <View style={listRowLayout.text}>
        {name !== undefined && name !== "" ? (
          <>
            <Text variant="bodyStrong">{name}</Text>
            <Text variant="bodySmall" tone="muted">
              {emailWithBreak(email)}
            </Text>
          </>
        ) : (
          <Text variant="rowValue">{emailWithBreak(email)}</Text>
        )}
      </View>
      {you !== undefined && <Badge label={you} tone="neutral" />}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: "center",
    borderRadius: discSize / 2,
    height: discSize,
    justifyContent: "center",
    width: discSize,
  },
  you: { backgroundColor: color.navy },
  other: { backgroundColor: color.sunken },
});
