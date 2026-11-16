import {
  AdministrationReservationCancellationInput,
  AdministrationReservationRestorationInput,
  AdministrationWorkspaceReservationId,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";

const reservationCancellationSchema = Schema.Struct({
  reservationId: AdministrationWorkspaceReservationId,
  ...AdministrationReservationCancellationInput.fields,
});

export const reservationCancellationStandardSchema = Schema.toStandardSchemaV1(
  reservationCancellationSchema
);

export type ReservationCancellationInput =
  typeof reservationCancellationSchema.Type;

// Spreading the contract's fields drops its strict parse options, so the
// struct restates them.
const reservationRestorationSchema = Schema.Struct({
  reservationId: AdministrationWorkspaceReservationId,
  ...AdministrationReservationRestorationInput.fields,
}).annotate({
  parseOptions: { errors: "all", onExcessProperty: "error" },
});

export const reservationRestorationStandardSchema = Schema.toStandardSchemaV1(
  reservationRestorationSchema
);

export type ReservationRestorationInput =
  typeof reservationRestorationSchema.Type;

const reservationLookupSchema = Schema.Struct({
  identifier: Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
});

export const reservationLookupStandardSchema = Schema.toStandardSchemaV1(
  reservationLookupSchema,
  {
    parseOptions: {
      errors: "all",
      onExcessProperty: "error",
    },
  }
);

export type ReservationLookupInput = typeof reservationLookupSchema.Type;
