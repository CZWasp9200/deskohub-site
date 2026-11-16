import type { CustomerEstablishment } from "@deskohub/workspace-customer-api";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
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
