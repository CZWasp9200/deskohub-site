import "server-only";

import { formatPhoneNumber, parsePhoneNumber } from "@deskohub/phone-number";
import { Effect, Option, Schema } from "effect";
import { makeAuthReturnState } from "@/features/account/backend/auth-return-state";
import {
  baseLocale,
  defaultPhoneRegion,
  type Locale,
  locales,
} from "@/features/i18n";
import { reservationBillingSelectionSchema } from "@/features/reservation/reservation-billing";
import {
  checkoutOfficeSelectionSchema,
  type ReservationCheckoutContact,
  reservationCheckoutContactSchema,
} from "@/features/reservation/reservation-checkout-contact";
import { normalizedReservationCustomerSchema } from "@/features/reservation/reservation-contact";
import { makeSealedState } from "@/shared/backend/sealed-state";
import { getRequestCookies } from "@/shared/backend/utils/request-cookies";

const officeSelectionIdSchema = Schema.String.check(Schema.isUUID(4));

/**
 * The sealed contact and the locale it was typed in, whose region its phone
 * is read in. A token sealed before contacts carried a locale has none; its
 * phone was read in the base locale's region.
 */
const sealedCheckoutContactSchema = Schema.Struct({
  ...normalizedReservationCustomerSchema.fields,
  billing: reservationBillingSelectionSchema,
  marketingConsent: Schema.Boolean,
  locale: Schema.optionalKey(Schema.Literals(locales)),
  officeSelectionId: Schema.optionalKey(officeSelectionIdSchema),
});

const sealedCheckoutContact = makeAuthReturnState(
  "checkout-contact",
  sealedCheckoutContactSchema
);

export const checkoutOfficeSelectionMaxAge = 30 * 60;

const sealedOfficeSelection = makeSealedState({
  purpose: "auth-return:checkout-office-selection",
  schema: Schema.Struct({
    id: officeSelectionIdSchema,
    selection: checkoutOfficeSelectionSchema,
  }),
  ttlMilliseconds: checkoutOfficeSelectionMaxAge * 1000,
  // Leave space for the name and attributes under the browser cookie limit.
  maxTokenLength: 3800,
});

export const checkoutOfficeSelectionCookieName = (id: string) =>
  `checkout-office-${id}`;

export const sealCheckoutOfficeSelection = sealedOfficeSelection.seal;

export const loadCheckoutOfficeSelection = Effect.fn(
  "reservationPage.loadCheckoutOfficeSelection"
)(function* (id: string) {
  const cookies = yield* getRequestCookies;
  const token = cookies.get(checkoutOfficeSelectionCookieName(id))?.value;
  if (!token) return undefined;
  const draft = yield* sealedOfficeSelection.open(token).pipe(Effect.option);
  return Option.isSome(draft) && draft.value.id === id
    ? draft.value.selection
    : undefined;
});

/**
 * The phone a page in `pageLocale` prefills. A page whose locale reads a
 * number without a country calling code in another region gets the number in
 * international form, so its form reads the number the customer typed.
 */
const phoneForPage = (phone: string, region: string, pageLocale: Locale) =>
  region === defaultPhoneRegion(pageLocale)
    ? phone
    : Option.match(parsePhoneNumber(phone, region), {
        onNone: () => phone,
        onSome: formatPhoneNumber,
      });

/** The checkout contact details sealed into a sign-in's return path. */
export const checkoutContactReturnState = {
  /** Seals the contact typed on a page in `locale`. */
  seal: (
    contact: ReservationCheckoutContact,
    locale: Locale,
    officeSelectionId?: string
  ) =>
    sealedCheckoutContact.seal({
      ...contact,
      locale,
      ...(officeSelectionId && { officeSelectionId }),
    }),
  /**
   * Opens a sealed contact for a page in `pageLocale`, its phone validated in
   * the region of the locale it was typed in.
   */
  open: (token: string, pageLocale: Locale) =>
    sealedCheckoutContact.open(token).pipe(
      Effect.flatMap(
        ({ locale = baseLocale, officeSelectionId, ...sealed }) => {
          const region = defaultPhoneRegion(locale);
          return Schema.decodeEffect(reservationCheckoutContactSchema(region))(
            sealed
          ).pipe(
            Effect.map((contact) => ({
              ...contact,
              phone: phoneForPage(contact.phone, region, pageLocale),
              ...(officeSelectionId && { officeSelectionId }),
            }))
          );
        }
      )
    ),
};
