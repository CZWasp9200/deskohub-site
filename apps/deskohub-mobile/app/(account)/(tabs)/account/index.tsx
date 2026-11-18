import { useIsFocused, useRouter, useSegments } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import {
  accountDetailSection,
  accountSectionHref,
} from "../../../../src/account/account-gating";
import { AccountIndexScreen } from "../../../../src/account/account-index-screen";
import { useScreenVisited } from "../../../../src/routing/use-screen-visited";
import { useViewport } from "../../../../src/ui/viewport";

/**
 * The Account root. Its stack mounts with the tabs (`accountTabOptions`), but
 * the screen renders on its first visit, so it reads and announces nothing
 * while another tab is in front.
 */
export default function AccountRoute() {
  const visited = useScreenVisited();
  const focused = useIsFocused();
  const router = useRouter();
  const segments: readonly string[] = useSegments();
  const { isExpanded } = useViewport();
  const detail = accountDetailSection(segments);
  const openedDetail = useRef(false);
  const inAccount = segments[1] === "(tabs)" && segments[2] === "account";
  useEffect(() => {
    if (!isExpanded || !inAccount) openedDetail.current = false;
    else if (detail !== undefined) openedDetail.current = true;
  }, [detail, inAccount, isExpanded]);

  const openDefault = useCallback(() => {
    // Select the real Profile route once, keeping the index below it for Back.
    if (isExpanded && focused && !openedDetail.current) {
      openedDetail.current = true;
      router.navigate(accountSectionHref.profile);
    }
  }, [focused, isExpanded, router]);

  if (!visited || (isExpanded && detail !== undefined)) return null;
  return <AccountIndexScreen onLinked={openDefault} />;
}
