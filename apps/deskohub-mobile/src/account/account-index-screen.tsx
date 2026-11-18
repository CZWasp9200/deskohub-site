import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { color, space } from "../ui/tokens";
import { useContentColumn, useViewport } from "../ui/viewport";
import {
  type AccountDetailSection,
  type AccountNotice,
  accountIndexModel,
} from "./account-gating";
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
export function AccountIndexScreen({
  activeSection,
  onLinked,
}: {
  readonly activeSection?: AccountDetailSection;
  readonly onLinked?: () => void;
}) {
  const locale = useAppLocale();
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  const release = useAccountRelease();
  const current = Option.getOrUndefined(AsyncResult.value(account));
  const { top } = useSafeAreaInsets();
  const { isWide, fontScale } = useViewport();
  const column = useContentColumn();
  const inPane = activeSection !== undefined;
  const linked = current?.kind === "linked";
  useEffect(() => {
    if (linked) onLinked?.();
  }, [linked, onLinked]);
  const notice =
    current === undefined ? undefined : accountIndexModel(current).notice;
  const shownNotice =
    notice === undefined || notice === "completion-required"
      ? undefined
      : noticeContent[notice];
  const title = m.account_tab_account({}, { locale });
  const identity = (
    <AccountIdentityView
      identity={
        current === undefined ? undefined : accountRootModel(current).identity
      }
      loading={AsyncResult.isInitial(account)}
      noProfile={current?.kind === "completion-required"}
    />
  );

  return (
    <ScrollScreen
      masthead={
        inPane ? (
          <View style={[styles.menuMasthead, { paddingTop: top + space.md }]}>
            <View style={[column, styles.menuIdentity]}>
              <View style={styles.identity}>{identity}</View>
              <SignOutButton onNavy />
            </View>
          </View>
        ) : (
          <Masthead
            compact
            title={title}
            actions={
              <SignOutButton
                onNavy={isWide}
                showLabel={isWide && fontScale < 1.5}
              />
            }
          >
            {identity}
          </Masthead>
        )
      }
      collapsedHeader={
        <>
          {!inPane && <FocusedStatusBar style="dark" />}
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
              <AccountRootGroups
                groups={model.groups}
                activeSection={activeSection}
              />
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
  menuMasthead: { backgroundColor: color.navy, paddingBottom: space.md },
  menuIdentity: { alignItems: "center", flexDirection: "row", gap: space.sm },
  identity: { flex: 1, minWidth: 0 },
  skeleton: { gap: space.xxl },
  version: { marginTop: space.sm, textAlign: "center" },
});
