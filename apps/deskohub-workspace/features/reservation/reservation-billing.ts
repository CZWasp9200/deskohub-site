import { Effect, Match, Schema } from "effect";
import {
  businessInvoiceBuyerSchema,
  type InvoiceBuyer,
  invoiceBuyerAddressSchema,
} from "@/features/accounting/billing-identity";

export const reservationBillingSelectionSchema = Schema.Union([
  Schema.Struct({
    purpose: Schema.Literal("personal"),
    invoice: Schema.Literal("none"),
  }),
  Schema.Struct({
    purpose: Schema.Literal("personal"),
    invoice: Schema.Literal("requested"),
    address: invoiceBuyerAddressSchema,
  }),
  Schema.Struct({
    purpose: Schema.Literal("business"),
    invoice: Schema.Literal("required"),
    buyer: businessInvoiceBuyerSchema,
  }),
]).annotate({
  identifier: "ReservationBillingSelection",
  description:
    "Customer-declared reservation purpose and its immutable invoice instruction.",
});

export type ReservationBillingSelection =
  typeof reservationBillingSelectionSchema.Type;
export type ReservationBillingSelectionInput =
  typeof reservationBillingSelectionSchema.Encoded;

export const defaultReservationBillingSelection = {
  purpose: "personal",
  invoice: "none",
} as const satisfies ReservationBillingSelection;

export const reservationBillingSelectionInputSchema =
  reservationBillingSelectionSchema.pipe(
    Schema.withDecodingDefaultKey(
      Effect.succeed(defaultReservationBillingSelection)
    ),
    Schema.withConstructorDefault(
      Effect.succeed(defaultReservationBillingSelection)
    )
  );

export const normalizedReservationBillingSelectionSchema = Schema.toType(
  reservationBillingSelectionSchema
).pipe(
  Schema.withDecodingDefaultKey(
    Effect.succeed(defaultReservationBillingSelection)
  ),
  Schema.withConstructorDefault(
    Effect.succeed(defaultReservationBillingSelection)
  )
);

export const emptyRequestedPersonalBillingSelection = {
  purpose: "personal",
  invoice: "requested",
  address: { line1: "", city: "", postalCode: "", country: "CZ" },
} as const satisfies ReservationBillingSelectionInput;

export const emptyBusinessBillingSelection = {
  purpose: "business",
  invoice: "required",
  buyer: {
    kind: "business",
    legalName: "",
    companyId: "",
    address: { line1: "", city: "", postalCode: "", country: "CZ" },
  },
} as const satisfies ReservationBillingSelectionInput;

export const getReservationInvoiceBuyer = (input: {
  readonly billing: ReservationBillingSelection;
  readonly customerName: string;
}): InvoiceBuyer | undefined =>
  Match.value(input.billing).pipe(
    Match.when({ purpose: "personal", invoice: "none" }, () => undefined),
    Match.when(
      { purpose: "personal", invoice: "requested" },
      ({ address }) => ({
        kind: "person" as const,
        legalName: input.customerName,
        address,
      })
    ),
    Match.when({ purpose: "business" }, ({ buyer }) => buyer),
    Match.exhaustive
  );
