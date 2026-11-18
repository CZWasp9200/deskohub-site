import type { Href, ImperativeRouter } from "expo-router";
import type { NavigationState } from "expo-router/react-navigation";
import type { BottomTabNavigationOptions } from "expo-router/tabs";
import { useCallback, useEffect, useRef } from "react";
import {
  type AccountDetailSection,
  accountSectionHref,
} from "./account-gating";

/** The Account tab's root: its index, the list of sections. */
export const accountRootHref = "/account" as const satisfies Href;

/**
 * Leaves an Account section for the Account root, such as after "Continue"
 * on a completed profile: back down the Account stack to its index, which
 * the stack's anchor keeps below every section, so the root shows no back
 * arrow. Not a replace: that swaps the section for a second index above
 * the anchored one, with a back arrow to the first.
 */
export const returnToAccountRoot = (
  router: Pick<ImperativeRouter, "dismissTo">
) => router.dismissTo(accountRootHref);

/**
 * The Account stack's anchor: its root, which Expo Router puts under a
 * section that opens the stack, so the section shows Back to the root.
 */
export const accountStackAnchor = "index";

export interface AccountSectionMenu {
  readonly activeSection: AccountDetailSection;
  readonly openSection: (section: AccountDetailSection) => void;
}

export const isProfileEditor = (section: AccountDetailSection) =>
  section === "profile" || section === "billing";

/** Opens the real Profile route when a linked overview enters expanded mode. */
export function useDefaultAccountProfile(
  router: Pick<ImperativeRouter, "navigate">,
  {
    focused,
    isExpanded,
    inAccount,
    detail,
  }: {
    readonly focused: boolean;
    readonly isExpanded: boolean;
    readonly inAccount: boolean;
    readonly detail: AccountDetailSection | undefined;
  }
) {
  const openedDetail = useRef(false);
  useEffect(() => {
    if (!isExpanded || !inAccount) openedDetail.current = false;
    else if (detail !== undefined) openedDetail.current = true;
  }, [detail, inAccount, isExpanded]);

  return useCallback(() => {
    // The index stays below the detail and remains reachable by Back.
    if (
      isExpanded &&
      inAccount &&
      focused &&
      detail === undefined &&
      !openedDetail.current
    ) {
      openedDetail.current = true;
      router.navigate(accountSectionHref.profile, {
        dangerouslySingular: true,
      });
    }
  }, [detail, focused, inAccount, isExpanded, router]);
}

/** Leaving the profile editors removes both in one guarded navigation action. */
export function accountSectionReset(
  root: NavigationState | undefined,
  section: AccountDetailSection
) {
  const account = root?.routes.find(({ name }) => name === "(account)")?.state;
  const tabs = account?.routes.find(({ name }) => name === "(tabs)")?.state;
  const stack = tabs?.routes.find(({ name }) => name === "account")?.state;
  if (stack?.stale !== false) return undefined;

  const anchor = stack.routes.find(({ name }) => name === accountStackAnchor);
  const detail = stack.routes.findLast(({ name }) => name === section);
  return {
    target: stack.key,
    state: {
      ...stack,
      index: 1,
      routes: [
        anchor ?? { name: accountStackAnchor },
        detail ?? { name: section },
      ],
    },
  };
}

/**
 * The Account tab's stack mounts with the tabs instead of on its first visit
 * (#1345). Expo Router puts a stack's anchor under the target only for the
 * link that starts the app (and a `withAnchor` navigation). A link that
 * arrives while the app runs creates a missing stack with the linked section
 * alone, but it pushes onto a stack that is already mounted, above the
 * root. The root screen itself renders on its first visit
 * (`useScreenVisited`), so start-up and the other tabs behave as before.
 */
export const accountTabOptions = {
  lazy: false,
} as const satisfies BottomTabNavigationOptions;
