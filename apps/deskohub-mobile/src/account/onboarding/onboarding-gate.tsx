import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import type {
  NavigationProp,
  ParamListBase,
} from "expo-router/react-navigation";
import { type ReactNode, useCallback } from "react";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { ScrollScreen } from "../../ui/scroll-screen";
import {
  completeProfileAtom,
  profileSubmitState,
} from "../profile/profile-save";
import type { CompletionRequiredAccount } from "./onboarding-draft";
import { onboardingView } from "./onboarding-model";
import { closeOnboarding, finishOnlyState } from "./onboarding-routes";

/**
 * An onboarding step for the account as GET /account reads it: the step's
 * form while the account needs a profile; the finish once this flow
 * created it, in place of the steps, so Back from the finish leaves
 * onboarding; and otherwise back to the screen onboarding opened over.
 * Only the step in view moves on, so one step navigates.
 */
export function OnboardingGate({
  children,
}: {
  readonly children: (account: CompletionRequiredAccount) => ReactNode;
}) {
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  const completion = profileSubmitState(useAtomValue(completeProfileAtom));
  const current = Option.getOrUndefined(AsyncResult.value(account));
  if (current === undefined)
    return (
      <ScrollScreen>
        <AsyncView result={account} onRetry={refresh}>
          {() => null}
        </AsyncView>
      </ScrollScreen>
    );
  if (current.kind === "completion-required") return children(current);
  return onboardingView(current, completion) === "finish" ? (
    <ShowFinish />
  ) : (
    <LeaveOnboarding />
  );
}

function ShowFinish() {
  // The onboarding stack, whose steps the finish replaces.
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  useFocusEffect(
    useCallback(() => {
      const stack = navigation.getState();
      if (stack !== undefined) navigation.reset(finishOnlyState(stack));
    }, [navigation])
  );
  return null;
}

/** Leaves onboarding once in view, like a `Redirect` back out of the stack. */
export function LeaveOnboarding() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      closeOnboarding(navigation, router);
    }, [navigation, router])
  );
  return null;
}
