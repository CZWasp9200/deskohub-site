import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Redirect } from "expo-router";
import { startTabAtom, startTabHref } from "../../src/routing/start-tab";

/**
 * The signed-in app opens on its start tab: Reservations when a booking is
 * coming up, otherwise Book. Nothing shows during the device read it takes
 * (see `startTabAtom`).
 */
export default function IndexRoute() {
  const startTab = useAtomValue(startTabAtom);
  return (
    AsyncResult.isSuccess(startTab) && (
      <Redirect href={startTabHref[startTab.value]} />
    )
  );
}
