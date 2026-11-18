import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { AsyncView } from "../customer-api/async-view";
import { accountAtom } from "../customer-api/customer-data-runtime";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { AppBar } from "../ui/app-bar";
import { FocusedStatusBar } from "../ui/focused-status-bar";
import { ListGroup, ListRow } from "../ui/list";
import { Masthead } from "../ui/masthead";
import { Notice } from "../ui/notice";
import { ScrollScreen } from "../ui/scroll-screen";
import { SkeletonGroup, SkeletonRow } from "../ui/skeleton";
import { Text } from "../ui/text";
import { space } from "../ui/tokens";
import { type AccountNotice, accountIndexModel } from "./account-gating";
import { AccountIdentityView } from "./account-identity-view";
import { useAccountRelease } from "./account-release";
import {
  AccountRootGroups,
  ProfileCompletionCard,
} from "./account-root-groups";
import { accountRootModel } from "./account-root-model";
import { SignupReferralNotice } from "./profile/signup-referral-notice";
import { SignOutButton } from "./sign-out-button";

const noticeContent: Record<
  // The completion card says it for an account without a profile.
  Exclude<AccountNotice, "completion-required">,
  {
    readonly tone: "info" | "warning";
    readonly message: (locale: AppLocale) => string;
  }
> = {
  "support-required": {
    tone: "warning",
    message: (locale) => m.account_notice_support_required({}, { locale }),
  },
  unavailable: {
    tone: "warning",
    message: (locale) => m.account_notice_unavailable({}, { locale }),
  },
  "deletion-pending": {
    tone: "info",
    message: (locale) => m.account_notice_deletion_pending({}, { locale }),
  },
};

/** The installed build's version, as app.json gives it to the native build. */
const appVersion = Constants.expoConfig?.version;

/**
 * The Account tab: the signed-in identity on the navy masthead with the
 * sign-out icon, then the account's sections as rows that say their current
 * state, gated by the account's state (GET /account), and the app version.
 * Once the masthead scrolls away an app bar keeps the title and sign-out.
 */
export function AccountIndexScreen() {
  const locale = useAppLocale();
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  const release = useAccountRelease();
  const current = Option.getOrUndefined(AsyncResult.value(account));
  const notice =
    current === undefined ? undefined : accountIndexModel(current).notice;
  const shownNotice =
    notice === undefined || notice === "completion-required"
      ? undefined
      : noticeContent[notice];
  const title = m.account_tab_account({}, { locale });

  return (
    <ScrollScreen
      masthead={
        <Masthead compact title={title} actions={<SignOutButton />}>
          <AccountIdentityView
            identity={
              current === undefined
                ? undefined
                : accountRootModel(current).identity
            }
            loading={AsyncResult.isInitial(account)}
            noProfile={current?.kind === "completion-required"}
          />
        </Masthead>
      }
      collapsedHeader={
        <>
          <FocusedStatusBar style="dark" />
          <AppBar title={title} raised actions={<SignOutButton />} />
        </>
      }
      // The first load shows the skeleton alone.
      refreshing={account.waiting && !AsyncResult.isInitial(account)}
      onRefresh={refresh}
    >
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice
        tone={shownNotice?.tone ?? "info"}
        message={shownNotice?.message(locale)}
      />
      <AsyncView
        result={account}
        onRetry={refresh}
        loading={
          <SkeletonGroup label={m.account_loading({}, { locale })}>
            <View style={styles.skeleton}>
              <ListGroup>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </ListGroup>
              <ListGroup>
                <SkeletonRow />
              </ListGroup>
            </View>
          </SkeletonGroup>
        }
      >
        {(loaded) => {
          const model = accountRootModel(loaded, release);
          return (
            <>
              {model.completionCard && <ProfileCompletionCard />}
              <SignupReferralNotice account={loaded} />
              <AccountRootGroups groups={model.groups} />
            </>
          );
        }}
      </AsyncView>
      {appVersion !== undefined && (
        <Text variant="caption" tone="muted" style={styles.version}>
          {m.account_app_version({ version: appVersion }, { locale })}
        </Text>
      )}
      {__DEV__ && <DevelopmentRows locale={locale} />}
    </ScrollScreen>
  );
}

/** Development builds only: the smoke checks and the component galleries. */
function DevelopmentRows({ locale }: { readonly locale: AppLocale }) {
  const router = useRouter();
  return (
    <ListGroup>
      <ListRow
        label={m.account_dev_smoke_link({}, { locale })}
        onPress={() => router.push("/dev/effect-smoke")}
      />
      <ListRow
        label={m.account_dev_design_system_link({}, { locale })}
        onPress={() => router.push("/dev/design-system")}
      />
      <ListRow
        label={m.account_dev_booking_components_link({}, { locale })}
        onPress={() => router.push("/dev/booking-components")}
      />
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: space.xxl },
  version: { marginTop: space.sm, textAlign: "center" },
});
