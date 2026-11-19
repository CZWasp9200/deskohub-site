import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { Redirect, useRouter } from "expo-router";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import CircleCheck from "lucide-react-native/icons/circle-check";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { Button } from "../../ui/controls";
import { EmptyState } from "../../ui/empty-state";
import { FocusedStatusBar } from "../../ui/focused-status-bar";
import { Icon } from "../../ui/icon";
import { useLiveRegionAnnouncement } from "../../ui/live-announcement";
import { Text } from "../../ui/text";
import { color, radius, space } from "../../ui/tokens";
import { useContentColumn, useViewport } from "../../ui/viewport";
import { QuietUpdateOffer } from "../../updates/update-offer-card";
import { LeaveOnboarding } from "./onboarding-gate";
import { finishOnboardingAt, onboardingHref } from "./onboarding-routes";

/**
 * Onboarding's finish (board 08): the profile exists, and the next step is
 * booking a workspace or the reservations, each its tab's root. It replaces
 * the steps, so Back leaves onboarding for the screen it opened over.
 */
export function OnboardingFinishScreen() {
  const locale = useAppLocale();
  const router = useRouter();
  const { isWide } = useViewport();
  const column = useContentColumn();
  const { bottom } = useSafeAreaInsets();
  const account = Option.getOrUndefined(
    AsyncResult.value(useAtomValue(accountAtom))
  );
  if (account === undefined) return null;
  if (account.kind === "completion-required")
    return <Redirect href={onboardingHref} />;
  if (account.kind !== "linked") return <LeaveOnboarding />;
  const title = m.onboarding_done_title(
    { name: account.profile.firstName },
    { locale }
  );
  const actions = (
    <View
      style={[
        styles.actions,
        isWide ? styles.wideActions : { paddingBottom: space.sm + bottom },
      ]}
    >
      <Button
        icon={CalendarPlus}
        label={m.reservations_book({}, { locale })}
        onPress={() => finishOnboardingAt(router, "book")}
      />
      <Button
        variant="quiet"
        label={m.reservations_go_to_list({}, { locale })}
        onPress={() => finishOnboardingAt(router, "reservations")}
      />
    </View>
  );
  return (
    <SafeAreaView
      edges={
        isWide ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]
      }
      style={styles.screen}
    >
      <FocusedStatusBar style="dark" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.body, isWide && column]}
      >
        <QuietUpdateOffer backdrop="paper" style={styles.updateOffer} />
        <View style={isWide ? styles.wideDone : styles.done}>
          {isWide ? (
            <WideConfirmation title={title} />
          ) : (
            <EmptyState
              icon={CircleCheck}
              tone="positive"
              live="polite"
              title={title}
            />
          )}
          {isWide && actions}
        </View>
      </ScrollView>
      {!isWide && actions}
    </SafeAreaView>
  );
}

function WideConfirmation({ title }: { readonly title: string }) {
  useLiveRegionAnnouncement(title, "polite");
  return (
    <>
      <View style={styles.successIcon}>
        <Icon icon={CircleCheck} color={color.positiveInk} size={32} />
      </View>
      <Text
        role="status"
        aria-live="polite"
        accessibilityLiveRegion="polite"
        variant="display"
        style={styles.successTitle}
      >
        {title}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  scroll: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: space.gutter },
  updateOffer: { marginTop: space.md },
  done: { flex: 1, justifyContent: "center" },
  wideDone: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: space.xxl,
  },
  successIcon: {
    alignItems: "center",
    backgroundColor: color.positiveTint,
    borderRadius: radius.card,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  successTitle: {
    marginTop: space.xl,
    maxWidth: 440,
    textAlign: "center",
  },
  actions: {
    gap: space.sm,
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
  },
  wideActions: {
    gap: space.xs,
    marginTop: space.xxxl,
    maxWidth: 320,
    paddingHorizontal: 0,
    paddingTop: 0,
    width: "100%",
  },
});
