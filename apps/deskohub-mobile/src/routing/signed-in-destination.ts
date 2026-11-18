import type { CustomerReservationFamily } from "@deskohub/workspace-customer-api";
import type { NavigationState } from "expo-router/react-navigation";

export type SignedInDestination =
  | CustomerReservationFamily
  | "account"
  | "reservations";

/** The same route groups stay in use at every width. */
export function signedInDestination(
  segments: readonly string[],
  checkoutFamily?: CustomerReservationFamily
): SignedInDestination | undefined {
  const [, group, screen] = segments;
  if (group === "(tabs)") {
    if (screen === "account" || screen === "reservations") return screen;
    return undefined;
  }
  if (group === "reservations") return "reservations";
  if (group !== "book") return undefined;
  switch (screen) {
    case "cowork":
    case "office":
    case "meeting-room":
      return screen;
    case "checkout":
    case "profile":
      return checkoutFamily;
    default:
      return undefined;
  }
}

/** Switch Choose screens without leaving checkout or its Profile in Back. */
export function bookingFamilyReset(
  root: NavigationState | undefined,
  family: CustomerReservationFamily
) {
  const account = root?.routes.find(({ name }) => name === "(account)")?.state;
  const book = account?.routes.find(({ name }) => name === "book")?.state;
  if (book?.stale !== false) return undefined;

  // One removal action lets the existing dirty Profile guard replay or cancel
  // the entire switch. Expo Router requires the complete stack state here.
  return {
    state: {
      ...book,
      index: 0,
      routes: [{ name: family }],
    },
    target: book.key,
  };
}
