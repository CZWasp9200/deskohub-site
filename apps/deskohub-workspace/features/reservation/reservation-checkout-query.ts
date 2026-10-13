import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Predicate, Record, Schema } from "effect";
import {
  reservationCustomerEmailSchema,
  reservationCustomerNameSchema,
  reservationCustomerPhoneSchema,
} from "@/features/reservation/reservation-contact";
import type { ReservationCustomerMode } from "@/features/reservation/reservation-existing-customer";
import { getSearchParam, type SupportedSearchParams } from "@/shared/utils";

const queryCustomerSchemas = {
  name: Schema.toStandardSchemaV1(reservationCustomerNameSchema),
  email: Schema.toStandardSchemaV1(reservationCustomerEmailSchema),
  phone: Schema.toStandardSchemaV1(reservationCustomerPhoneSchema),
};

export const getTrimmedSearchParam = (
  searchParams: SupportedSearchParams,
  key: string
) => {
  const value = getSearchParam(searchParams, key)?.trim();
  return value || undefined;
};

export const decodeReservationCheckoutCustomer = (
  searchParams: SupportedSearchParams
): { [Key in keyof typeof queryCustomerSchemas]?: string } =>
  Record.filter(
    Record.map(queryCustomerSchemas, (schema, key): string | undefined =>
      decodeStandardSchema(schema, getTrimmedSearchParam(searchParams, key))
    ),
    Predicate.isNotUndefined
  );

/**
 * Query parameter that tells a signed-in visit whether the link prefills the
 * standing customer (`account`) or the exact contact in the link
 * (`contact`).
 */
export const reservationCustomerQueryParam = "customer";

const queryCustomerModeSchema = Schema.toStandardSchemaV1(
  Schema.Literals(["account", "contact"] as const)
);

/**
 * The customer mode a link asks for. An explicit `customer` parameter wins;
 * otherwise, on forms whose links prefill the contact, any contact field
 * asks for that exact contact. A link without either leaves the choice to
 * the page.
 */
export const getReservationCustomerQueryMode = (
  searchParams: SupportedSearchParams,
  { prefillsContact = true }: { readonly prefillsContact?: boolean } = {}
): ReservationCustomerMode | undefined =>
  decodeStandardSchema(
    queryCustomerModeSchema,
    getTrimmedSearchParam(searchParams, reservationCustomerQueryParam)
  ) ??
  (prefillsContact &&
  Record.keys(queryCustomerSchemas).some(
    (key) => getTrimmedSearchParam(searchParams, key) !== undefined
  )
    ? "contact"
    : undefined);
