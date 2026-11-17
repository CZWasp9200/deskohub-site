import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { Button, TextField } from "../ui/controls";
import { space } from "../ui/tokens";
import { AppSignInLayout } from "./app-sign-in-layout";

/**
 * The email step of a sign-in page the app opens in the browser: the email
 * field in the middle, focused on load so the keyboard comes up, and the
 * submit action at the bottom. A `locked` address is shown read-only, for a
 * sign-in that must stay with one account. `busy` keeps the field and the
 * action from taking input while the email is sent.
 */
export function AppSignInEmailStep({
  title,
  body,
  illustration,
  email,
  submitLabel,
  onSubmit,
  busy,
  error,
}: {
  readonly title: string;
  readonly body?: string;
  readonly illustration?: ReactNode;
  readonly email: {
    readonly value: string;
    readonly locked: boolean;
    onChange(value: string): void;
  };
  readonly submitLabel: string;
  onSubmit(): void;
  readonly busy: boolean;
  readonly error?: string;
}) {
  const locale = useAppLocale();
  return (
    <AppSignInLayout
      title={title}
      instructions={body}
      // The shield and the locked address start under the text (board 19).
      childrenPlacement={illustration === undefined ? "centred" : "under-text"}
      action={
        <Button
          label={busy ? m.signin_sending_code({}, { locale }) : submitLabel}
          onPress={onSubmit}
          busy={busy}
        />
      }
    >
      <View style={styles.field}>
        {illustration}
        <TextField
          label={m.signin_email_field_label({}, { locale })}
          placeholder={m.signin_email_placeholder({}, { locale })}
          value={email.value}
          onChangeText={email.onChange}
          onSubmitEditing={onSubmit}
          error={error}
          readOnly={email.locked}
          disabled={busy}
          autoFocus={!email.locked}
          autoComplete="email"
          inputMode="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="send"
        />
      </View>
    </AppSignInLayout>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xxl },
});
