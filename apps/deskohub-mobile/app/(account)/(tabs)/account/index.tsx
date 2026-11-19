import { useIsFocused, useRouter, useSegments } from "expo-router";
import { accountDetailSection } from "../../../../src/account/account-gating";
import { AccountIndexScreen } from "../../../../src/account/account-index-screen";
import { useDefaultAccountProfile } from "../../../../src/account/account-root";
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
  const inAccount = segments[1] === "(tabs)" && segments[2] === "account";
  const openDefault = useDefaultAccountProfile(router, {
    detail,
    focused,
    inAccount,
    isExpanded,
  });

  if (!visited || (isExpanded && detail !== undefined)) return null;
  return <AccountIndexScreen onLinked={openDefault} />;
}
