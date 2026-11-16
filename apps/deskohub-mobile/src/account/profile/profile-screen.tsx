import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Match, Option } from "effect";
import { AsyncResult, type Atom } from "effect/unstable/reactivity";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect } from "react";
import { KeyboardAvoidingView, StyleSheet, View } from "react-native";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { ActionFooter } from "../../ui/action-footer";
import { Button } from "../../ui/controls";
import { SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { useToast } from "../../ui/toast";
import { color, space } from "../../ui/tokens";
import { initialsOf } from "../account-root-model";
import { ReturnToAccountRoot } from "../return-to-account-root";
import { AvatarSection } from "./avatar/avatar-section";
import { LoginEmailCard } from "./login-email-card";
import { identityFields } from "./profile-draft";
import { ProfileTextFields } from "./profile-fields";
import {
  type ProfileFooterMessage,
  profileFooterView,
} from "./profile-footer-view";
import {
  invalidOf,
  UnsavedChangesGuard,
  useFocusFirstInvalid,
  useProfileForm,
} from "./profile-form";

type LinkedAccount = Extract<CustomerAccountState, { kind: "linked" }>;

/**
 * Profile: the photo and initials, the verified login email (read-only),
 * and the name and phone of the linked account's profile, saved from a
 * footer that stays above the keyboard (the tab layout hides the tab bar
 * here, see `tabBarHidden`). Reached from the Account tab, or from
 * checkout's "Booking as".
 */
export function ProfileScreen() {
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  const linked = Option.filter(
    AsyncResult.value(account),
    (current): current is LinkedAccount => current.kind === "linked"
  );
  if (Option.isSome(linked))
    return (
      <ProfileForm
        account={linked.value}
        result={account}
        onRefresh={refresh}
      />
    );
  return (
    <ScrollScreen refreshing={account.waiting} onRefresh={refresh}>
      <AsyncView result={account} onRetry={refresh}>
        {/* The Account tab explains why an account without a profile can't edit it. */}
        {() => <ReturnToAccountRoot />}
      </AsyncView>
    </ScrollScreen>
  );
}

function ProfileForm({
  account,
  result,
  onRefresh,
}: {
  readonly account: LinkedAccount;
  readonly result: Atom.Type<typeof accountAtom>;
  readonly onRefresh: () => void;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const toast = useToast();
  const headerHeight = useHeaderHeight();
  const form = useProfileForm(account);
  const { inputs } = useFocusFirstInvalid(form.state, identityFields);
  const footer = profileFooterView(form.state, form.unsaved, identityFields);
  const saved = form.state._tag === "Done";

  useEffect(() => {
    if (saved) toast.show({ message: m.profile_saved({}, { locale }) });
  }, [saved, toast, locale]);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      // The view's frame starts under the stack header.
      keyboardVerticalOffset={headerHeight}
      style={styles.screen}
    >
      <UnsavedChangesGuard
        unsaved={form.unsaved}
        onDiscard={form.discard}
        sharedWith={["billing"]}
        locale={locale}
      />
      <ScrollScreen refreshing={result.waiting} onRefresh={onRefresh}>
        <AsyncView result={result} onRetry={onRefresh}>
          {() => (
            <>
              <AvatarSection
                avatar={account.avatar}
                initials={initialsOf(account.profile)}
              />
              <View>
                <SectionHeader title={m.profile_email_label({}, { locale })} />
                <LoginEmailCard email={account.email} />
              </View>
              <View style={styles.fields}>
                <SectionHeader
                  title={m.profile_identity_section({}, { locale })}
                />
                <ProfileTextFields
                  fields={identityFields}
                  draft={form.draft}
                  invalid={invalidOf(form.state)}
                  onChange={form.setField}
                  inputs={inputs}
                  editable={!footer.saving}
                  locale={locale}
                />
              </View>
            </>
          )}
        </AsyncView>
      </ScrollScreen>
      <ActionFooter
        message={footerMessage(footer.message, locale)}
        messageTone={
          footer.message === undefined || footer.message.kind === "no-changes"
            ? "neutral"
            : "error"
        }
      >
        <Button
          label={m.profile_save({}, { locale })}
          onPress={form.save}
          disabled={!footer.saveEnabled}
          busy={footer.saving}
        />
        {footer.message?.kind === "fix-elsewhere" && (
          <Button
            variant="secondary"
            label={m.account_section_billing({}, { locale })}
            onPress={() => router.push("/account/billing")}
          />
        )}
      </ActionFooter>
    </KeyboardAvoidingView>
  );
}

const footerMessage = (
  message: ProfileFooterMessage | undefined,
  locale: AppLocale
): string | undefined =>
  message === undefined
    ? undefined
    : Match.value(message).pipe(
        Match.discriminatorsExhaustive("kind")({
          "no-changes": () => m.profile_no_changes({}, { locale }),
          "fix-fields": ({ count }) =>
            count === 1
              ? m.profile_fix_one_field({}, { locale })
              : m.profile_fix_fields({ count }, { locale }),
          "fix-elsewhere": () => m.profile_invalid_on_billing({}, { locale }),
          failed: ({ error }) =>
            error._tag === "LinkRequired"
              ? m.profile_link_required({}, { locale })
              : (sharedViewErrorMessage(error, locale) ??
                m.profile_save_failed({}, { locale })),
        })
      );

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  fields: { gap: space.lg },
});
