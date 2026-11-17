import { AccountIndexScreen } from "../../../../src/account/account-index-screen";
import { useScreenVisited } from "../../../../src/routing/use-screen-visited";

/**
 * The Account root. Its stack mounts with the tabs (`accountTabOptions`), but
 * the screen renders on its first visit, so it reads and announces nothing
 * while another tab is in front.
 */
export default function AccountRoute() {
  return useScreenVisited() ? <AccountIndexScreen /> : null;
}
