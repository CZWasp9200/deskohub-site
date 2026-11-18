import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult, type Atom } from "effect/reactivity";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect } from "react";
import { KeyboardAvoidingView, StyleSheet, View } from "react-native";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { useToast } from "../../ui/toast";
import { color, space } from "../../ui/tokens";
import { contentColumnWidth, useViewport, wideGutter } from "../../ui/viewport";
import { QuietUpdateOffer } from "../../updates/update-offer-card";
import { initialsOf } from "../account-root-model";
import { ReturnToAccountRoot } from "../return-to-account-root";
import { AvatarSection } from "./avatar/avatar-section";
import { LoginEmailCard } from "./login-email-card";
import { identityFields } from "./profile-draft";
import { ProfileTextFields } from "./profile-fields";
import {
  invalidOf,
  UnsavedChangesGuard,
  useFocusFirstInvalid,
  useProfileForm,
} from "./profile-form";
import { ProfileFormFooter } from "./profile-form-footer";

type LinkedAccount = Extract<CustomerAccountState, { kind: "linked" }>;

/**
 * Profile: the photo and initials, the verified login email (read-only),
 * and the name and phone of the linked account's profile, saved from a
 * footer that stays above the keyboard (the tab layout hides the tab bar
 * here, see `tabBarHidden`). Reached from the Account tab, or from
 * checkout's "Booking as", where it is part of the booking flow and shows
 * the quiet update offer (`hostsUpdateOffer`).
 */
export function ProfileScreen({
  hostsUpdateOffer = false,
  presentation,
}: {
  readonly hostsUpdateOffer?: boolean;
  readonly presentation?: "checkout";
} = {}) {
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
        hostsUpdateOffer={hostsUpdateOffer}
        checkout={presentation === "checkout"}
      />
    );
  return (
    <ScrollScreen refreshing={account.waiting} onRefresh={refresh}>
      {hostsUpdateOffer && <QuietUpdateOffer backdrop="paper" />}
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
  hostsUpdateOffer,
  checkout,
}: {
  readonly account: LinkedAccount;
  readonly result: Atom.Type<typeof accountAtom>;
  readonly onRefresh: () => void;
  readonly hostsUpdateOffer: boolean;
  readonly checkout: boolean;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const toast = useToast();
  const headerHeight = useHeaderHeight();
  const form = useProfileForm(account);
  const { inputs } = useFocusFirstInvalid(form.state, identityFields);
  const saving = form.state._tag === "Submitting";
  const saved = form.state._tag === "Done";
  const { availableWidth, fontScale, isExpanded, isWide } = useViewport();
  const wideTracks = checkout && isExpanded && fontScale < 1.5;
  const contentWidth = wideTracks ? "wide" : "form";
  const formWidth = Math.min(
    contentColumnWidth[contentWidth],
    availableWidth - 2 * wideGutter
  );
  const pairNames =
    isWide && !wideTracks && formWidth >= 440 && fontScale < 1.5;
  const fieldProps = {
    draft: form.draft,
    invalid: invalidOf(form.state),
    onChange: form.setField,
    inputs,
    editable: !saving,
    locale,
  };
  const [firstName, lastName, phone] = identityFields;

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
      <ScrollScreen
        contentWidth={contentWidth}
        refreshing={result.waiting}
        onRefresh={onRefresh}
      >
        {hostsUpdateOffer && <QuietUpdateOffer backdrop="paper" />}
        <AsyncView result={result} onRetry={onRefresh}>
          {() => (
            <View
              style={[
                styles.profile,
                isWide && styles.wideProfile,
                wideTracks && styles.tracks,
              ]}
            >
              <View
                style={[
                  styles.profile,
                  isWide && styles.wideProfile,
                  wideTracks && styles.track,
                ]}
              >
                <AvatarSection
                  avatar={account.avatar}
                  initials={initialsOf(account.profile)}
                  inlineActions={wideTracks}
                />
                <View>
                  <SectionHeader
                    title={m.profile_email_label({}, { locale })}
                  />
                  <LoginEmailCard email={account.email} />
                </View>
              </View>
              <View style={[styles.fields, wideTracks && styles.track]}>
                <SectionHeader
                  title={m.profile_identity_section({}, { locale })}
                />
                <View style={[styles.fields, pairNames && styles.pairedFields]}>
                  <View style={pairNames && styles.track}>
                    <ProfileTextFields {...fieldProps} fields={[firstName]} />
                  </View>
                  <View style={pairNames && styles.track}>
                    <ProfileTextFields {...fieldProps} fields={[lastName]} />
                  </View>
                </View>
                <View style={pairNames && styles.halfField}>
                  <ProfileTextFields {...fieldProps} fields={[phone]} />
                </View>
              </View>
            </View>
          )}
        </AsyncView>
      </ScrollScreen>
      <ProfileFormFooter
        state={form.state}
        unsaved={form.unsaved}
        shownFields={identityFields}
        onSave={form.save}
        elsewhere={{
          message: m.profile_invalid_on_billing({}, { locale }),
          label: m.account_section_billing({}, { locale }),
          onPress: () => router.push("/account/billing"),
        }}
        locale={locale}
        layout={isWide ? "inline" : "stacked"}
        contentWidth={contentWidth}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  profile: { gap: space.md },
  wideProfile: { gap: space.xl },
  tracks: { alignItems: "flex-start", flexDirection: "row", gap: space.xxl },
  track: { flex: 1, minWidth: 0 },
  fields: { gap: space.lg },
  pairedFields: { flexDirection: "row", alignItems: "flex-start" },
  halfField: { width: "50%", paddingRight: space.lg / 2 },
});
