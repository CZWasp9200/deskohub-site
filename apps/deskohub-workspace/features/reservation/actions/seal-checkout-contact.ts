"use server";

import { Effect, Result, Schema } from "effect";
import { defaultPhoneRegion, type Locale } from "@/features/i18n";
import { validateOfficePeople } from "@/features/office/office-people";
import {
  checkoutContactReturnState,
  checkoutOfficeSelectionCookieName,
  checkoutOfficeSelectionMaxAge,
  sealCheckoutOfficeSelection,
} from "@/features/reservation/backend/checkout-contact-return-state";
import {
  checkoutOfficeSelectionSchema,
  reservationCheckoutContactSchema,
} from "@/features/reservation/reservation-checkout-contact";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { getRequestCookies } from "@/shared/backend/utils/request-cookies";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const sealCheckoutContactAction = defineWorkspaceAction(
  {
    operation: "reservation.checkout-contact.seal",
    logInput: false,
    // The phone is read in the region of the locale it was typed in, and the
    // sealed contact keeps that locale so it reopens in the same region.
    schema: (locale: Locale) =>
      Schema.toStandardSchemaV1(
        Schema.Struct({
          ...reservationCheckoutContactSchema(defaultPhoneRegion(locale))
            .fields,
          officeSelection: Schema.optionalKey(checkoutOfficeSelectionSchema),
        }).check(
          Schema.makeFilter(
            ({ email, officeSelection }) =>
              officeSelection?.kind !== "people" ||
              Result.isSuccess(
                validateOfficePeople(officeSelection.people, {
                  contactEmail: email,
                  // Live capacity is checked when the office form reopens.
                  seatCapacity: Infinity,
                })
              ) || {
                path: ["officeSelection"],
                issue: "Invalid office guests.",
              }
          )
        ),
        { parseOptions: { onExcessProperty: "error" } }
      ),
  },
  Effect.fnUntraced(function* ({ officeSelection, ...contact }, { locale }) {
    if (!officeSelection) {
      return { token: yield* checkoutContactReturnState.seal(contact, locale) };
    }
    const id = crypto.randomUUID();
    const token = yield* checkoutContactReturnState.seal(contact, locale, id);
    const draft = yield* sealCheckoutOfficeSelection({
      id,
      selection: officeSelection,
    });
    const cookies = yield* getRequestCookies;
    cookies.set(checkoutOfficeSelectionCookieName(id), draft, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: checkoutOfficeSelectionMaxAge,
      path: "/",
    });
    return { token };
  }, Effect.provide(SealedStateKeys.Default))
);

export const sealCheckoutContact: typeof sealCheckoutContactAction = async (
  ...args: Parameters<typeof sealCheckoutContactAction>
) => {
  "use server";
  return await sealCheckoutContactAction(...args);
};
