import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { Redirect, useRouter } from "expo-router";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import CircleCheck from "lucide-react-native/icons/circle-check";
import { StyleSheet, View } from "react-native";
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
import { color, space } from "../../ui/tokens";
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
  const { bottom } = useSafeAreaInsets();
  const account = Option.getOrUndefined(
    AsyncResult.value(useAtomValue(accountAtom))
  );
  if (account === undefined) return null;
  if (account.kind === "completion-required")
    return <Redirect href={onboardingHref} />;
  if (account.kind !== "linked") return <LeaveOnboarding />;
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <FocusedStatusBar style="dark" />
      <View style={styles.body}>
        <EmptyState
          icon={CircleCheck}
          tone="positive"
          live="polite"
          title={m.onboarding_done_title(
            { name: account.profile.firstName },
            { locale }
          )}
        />
      </View>
      <View style={[styles.actions, { paddingBottom: space.sm + bottom }]}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  body: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: space.gutter,
  },
  actions: {
    gap: space.sm,
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
  },
});
