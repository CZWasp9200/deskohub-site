import type { CustomerEstablishment } from "@deskohub/workspace-customer-api";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { Linking } from "react-native";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";

/**
 * Where the booked space is (GET /reservations/establishment), read once
 * per session: every booking is at the same address.
 */
export const establishmentAtom = customerDataRuntime
  .atom(
    Effect.flatMap(Effect.service(CustomerApi), (api) =>
      api.reservations.getEstablishment()
    ).pipe(customerRead({ accountRead: false }))
  )
  .pipe(Atom.keepAlive);

/** The address as a ticket's place line: the street and the city. */
export const establishmentPlace = ({ address }: CustomerEstablishment) =>
  `${address.street}, ${address.city}`;

/**
 * The address in normal postal format: the street and number, then the
 * postal code, city and district, as the Workspace's one-line address
 * (`formattedAddress`) joins them.
 */
export const establishmentAddressLines = ({
  address,
}: CustomerEstablishment): readonly [string, string] => [
  address.street,
  `${address.postalCode} ${address.city} - ${address.cityDistrict}`,
];

/** What copying the address puts on the clipboard: the place's name and its address. */
export const establishmentCopyText = ({
  name,
  formattedAddress,
}: CustomerEstablishment) => `${name}, ${formattedAddress}`;

/** Opens the Workspace's directions to the space in the maps app or browser. */
export const openDirections = ({ directionsUrl }: CustomerEstablishment) => {
  void Linking.openURL(directionsUrl).catch(() => undefined);
};
