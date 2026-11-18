import type { CustomerReservationFamily } from "@deskohub/workspace-customer-api";

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
