import type {
  CustomerAccountState,
  CustomerCompanyDetails,
  CustomerProfileBilling,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { CompanyDetailsField } from "../../company-lookup/company-lookup-model";
import { defaultCountry, invoiceCountryCodes } from "../../i18n/country-names";
import type { CheckoutDetails } from "../checkout/checkout-state";

/**
 * The details step's form, as the site's contact and billing step asks it
 * (apps/deskohub-workspace/features/reservation/components/
 * reservation-customer-fields.tsx, reservation-billing-fields.tsx).
 */

/** Who the signed-in account books as when it books for itself. */
export interface SelfContact {
  readonly email: string;
  /** The saved profile's name; none asks for it (no linked profile yet). */
  readonly name: Option.Option<string>;
  /** The saved phone when it's valid; none asks for one inline. */
  readonly phone: Option.Option<string>;
}

/** An invoice address as create checkout sends it; `country` is ISO alpha-2. */
export interface InvoiceAddress {
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
}

export type AddressDraft = InvoiceAddress;

export interface CompanyDraft {
  readonly legalName: string;
  readonly companyId: string;
  readonly vatId: string;
  readonly address: AddressDraft;
}

/**
 * What Account › Billing details already holds: a complete personal address
 * "Invoice to me" offers as it is, and a business's details the company
 * form starts from.
 */
export interface SavedBilling {
  readonly address: Option.Option<InvoiceAddress>;
  readonly company: Option.Option<CompanyDraft>;
}

/** Who books, and what the account saved for invoices. */
export interface DetailsProfile {
  readonly self: SelfContact;
  readonly saved: SavedBilling;
}

/**
 * Whether the account can fill in the details step:
 * - `Ready`: a linked profile books as itself, or an account without one
 *   enters its name and phone (the booking completes its profile).
 * - `Unavailable`: the account can't book until support or deletion is
 *   resolved, or its state couldn't be read.
 */
export type DetailsAccess =
  | ({ readonly _tag: "Ready" } & DetailsProfile)
  | {
      readonly _tag: "Unavailable";
      readonly reason:
        | "support-required"
        | "deletion-pending"
        | "authenticated-unavailable";
    };

const nonBlank = (value: string | null | undefined): Option.Option<string> =>
  Option.fromNullishOr(value).pipe(
    Option.map((text) => text.trim()),
    Option.filter((text) => text !== "")
  );

/** The site shows the saved phone only when it's valid, else asks inline. */
const savedPhone = (phone: string | null) =>
  nonBlank(phone).pipe(Option.filter(isPhoneNumber));

const emptyAddress: AddressDraft = {
  line1: "",
  city: "",
  postalCode: "",
  country: defaultCountry,
};

const text = (value: string | null) =>
  Option.getOrElse(nonBlank(value), () => "");

const savedCountry = (country: string | null) =>
  nonBlank(country).pipe(
    Option.map((code) => code.toUpperCase()),
    Option.filter((code) => invoiceCountryCodes.includes(code))
  );

const savedAddressDraft = (billing: CustomerProfileBilling): AddressDraft => ({
  line1: text(billing.addressLine1),
  city: text(billing.city),
  postalCode: text(billing.zip),
  country: Option.getOrElse(
    savedCountry(billing.country),
    () => defaultCountry
  ),
});

const noSavedBilling: SavedBilling = {
  address: Option.none(),
  company: Option.none(),
};

/**
 * The saved billing details: a personal address only when every part the
 * invoice needs is there, and a business's details as far as they go.
 */
export const savedBillingOf = (
  billing: CustomerProfileBilling | null
): SavedBilling => {
  if (billing === null) return noSavedBilling;
  if (billing.kind === "business") {
    return {
      address: Option.none(),
      company: Option.some({
        legalName: text(billing.companyName),
        companyId: text(billing.companyId),
        vatId: text(billing.vatId),
        address: savedAddressDraft(billing),
      }),
    };
  }
  const address = savedAddressDraft(billing);
  const complete =
    address.line1 !== "" &&
    address.city !== "" &&
    address.postalCode !== "" &&
    Option.isSome(savedCountry(billing.country));
  return {
    address: complete ? Option.some(address) : Option.none(),
    company: Option.none(),
  };
};

export const detailsAccess = (account: CustomerAccountState): DetailsAccess => {
  switch (account.kind) {
    case "linked": {
      const { firstName, lastName } = account.profile;
      const name = [nonBlank(firstName), nonBlank(lastName)]
        .flatMap((part) => (Option.isSome(part) ? [part.value] : []))
        .join(" ");
      return {
        _tag: "Ready",
        self: {
          email: account.email,
          name: nonBlank(name),
          phone: savedPhone(account.profile.phone),
        },
        saved: savedBillingOf(account.profile.billing),
      };
    }
    case "completion-required":
    case "review-account":
      return {
        _tag: "Ready",
        self: {
          email: account.email,
          name: Option.none(),
          phone: Option.none(),
        },
        saved: noSavedBilling,
      };
    case "support-required":
    case "deletion-pending":
    case "authenticated-unavailable":
      return { _tag: "Unavailable", reason: account.kind };
  }
};

/**
 * The contact to book as once the server rejected a saved name or phone:
 * that field is asked for inline, as a missing one is, so the customer can
 * correct it (the app's checks are looser than the server's).
 */
export const withRejectedSavedFields = (
  self: SelfContact,
  rejected: ReadonlySet<"name" | "phone">
): SelfContact => ({
  ...self,
  name: rejected.has("name") ? Option.none() : self.name,
  phone: rejected.has("phone") ? Option.none() : self.phone,
});

/** What the invoice needs: none, a personal invoice, or a business one. */
export type BillingChoice = "none" | "personal-invoice" | "business";

export interface DetailsDraft {
  readonly bookingFor: CheckoutDetails["bookingFor"];
  /** What the account enters about itself when the profile lacks it. */
  readonly self: { readonly name: string; readonly phone: string };
  /** Kept while the customer switches back to booking for themselves. */
  readonly someoneElse: {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
  };
  readonly billing: BillingChoice;
  /** "Invoice to me" without a complete saved address. */
  readonly personalAddress: AddressDraft;
  /** "Invoice to a company"; kept apart, so switching keeps both. */
  readonly company: CompanyDraft;
  /** Self only; unticked records nothing and withdraws nothing. */
  readonly marketingConsent: boolean;
}

/**
 * The form a booking starts with: no invoice, as on the site; a saved
 * address is offered, not chosen. The company form starts from the saved
 * business details.
 */
export const initialDetailsDraft = (saved: SavedBilling): DetailsDraft => ({
  bookingFor: "self",
  self: { name: "", phone: "" },
  someoneElse: { name: "", email: "", phone: "" },
  billing: "none",
  personalAddress: emptyAddress,
  company: Option.getOrElse(saved.company, () => ({
    legalName: "",
    companyId: "",
    vatId: "",
    address: emptyAddress,
  })),
  marketingConsent: false,
});

/** A form field, named as the details step shows it, in screen order. */
export const detailsFields = [
  "name",
  "email",
  "phone",
  "buyer.legalName",
  "buyer.companyId",
  "buyer.vatId",
  "address.line1",
  "address.city",
  "address.postalCode",
  "address.country",
] as const;
export type DetailsField = (typeof detailsFields)[number];

const contactFields: ReadonlyArray<DetailsField> = ["name", "email", "phone"];
const billingFields: ReadonlyArray<DetailsField> = detailsFields.filter(
  (field) => !contactFields.includes(field)
);

/**
 * - `required`, `invalid_country`: each field says what to enter.
 * - `invalid`: the server rejected the field without saying why.
 */
export type FieldProblem =
  | "required"
  | "too_short"
  | "too_long"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_country"
  | "invalid";

export type DetailsFieldProblems = Partial<Record<DetailsField, FieldProblem>>;

/** The problems in screen order, the first one to bring into view. */
export const orderedProblems = (problems: DetailsFieldProblems) =>
  detailsFields.flatMap((field) => {
    const problem = problems[field];
    return problem === undefined ? [] : [{ field, problem }];
  });

const without = (
  problems: DetailsFieldProblems,
  fields: ReadonlyArray<DetailsField>
): DetailsFieldProblems =>
  Object.fromEntries(
    Object.entries(problems).filter(
      ([field]) => !fields.includes(field as DetailsField)
    )
  );

/**
 * What a change does to the problems on show: problems belong to the form
 * that was submitted, so typing in a field clears its own, and switching who
 * the booking is for or the invoice type clears that part's (the other
 * form's fields are no longer the ones being checked).
 */
/**
 * Where each detail of the company lookup goes in the company form: its
 * field, and the form with the detail in it. The form has no second address
 * line, so the registry's is left out.
 */
const companyDetailTargets = {
  companyName: {
    field: "buyer.legalName",
    put: (company, legalName) => ({ ...company, legalName }),
  },
  companyId: {
    field: "buyer.companyId",
    put: (company, companyId) => ({ ...company, companyId }),
  },
  vatId: {
    field: "buyer.vatId",
    put: (company, vatId) => ({ ...company, vatId }),
  },
  addressLine1: {
    field: "address.line1",
    put: (company, line1) => ({
      ...company,
      address: { ...company.address, line1 },
    }),
  },
  city: {
    field: "address.city",
    put: (company, city) => ({
      ...company,
      address: { ...company.address, city },
    }),
  },
  zip: {
    field: "address.postalCode",
    put: (company, postalCode) => ({
      ...company,
      address: { ...company.address, postalCode },
    }),
  },
  country: {
    field: "address.country",
    put: (company, country) => ({
      ...company,
      address: { ...company.address, country },
    }),
  },
} as const satisfies Partial<
  Record<
    CompanyDetailsField,
    {
      readonly field: DetailsField;
      readonly put: (company: CompanyDraft, value: string) => CompanyDraft;
    }
  >
>;

type CompanyLookupField = keyof typeof companyDetailTargets;

/** The details the company form takes from a company lookup, in its order. */
export const companyLookupFields = Object.keys(
  companyDetailTargets
) as ReadonlyArray<CompanyLookupField>;

/**
 * The company form with a lookup's applied `details` in it, as if typed, and
 * the fields that changed.
 */
export const companyWithDetails = (
  company: CompanyDraft,
  details: Partial<CustomerCompanyDetails>
): {
  readonly company: CompanyDraft;
  readonly fields: ReadonlyArray<DetailsField>;
} =>
  companyLookupFields.reduce(
    (applied, detail) => {
      const value = details[detail];
      if (value === undefined) return applied;
      const target = companyDetailTargets[detail];
      return {
        company: target.put(applied.company, value),
        fields: [...applied.fields, target.field],
      };
    },
    { company, fields: [] as ReadonlyArray<DetailsField> }
  );

export type DetailsChange =
  | { readonly _tag: "Field"; readonly field: DetailsField }
  /** Several fields at once, as an applied company lookup changes them. */
  | { readonly _tag: "Fields"; readonly fields: ReadonlyArray<DetailsField> }
  | { readonly _tag: "BookingFor" }
  | { readonly _tag: "Billing" };

export const problemsAfterChange = (
  problems: DetailsFieldProblems,
  change: DetailsChange
): DetailsFieldProblems => {
  switch (change._tag) {
    case "Field":
      return without(problems, [change.field]);
    case "Fields":
      return without(problems, change.fields);
    case "BookingFor":
      return without(problems, contactFields);
    case "Billing":
      return without(problems, billingFields);
  }
};

export type DetailsValidation =
  | { readonly _tag: "Valid"; readonly details: CheckoutDetails }
  | { readonly _tag: "Invalid"; readonly problems: DetailsFieldProblems };

/** Lengths as the site's contact schema and the API contract cap them. */
const limits = {
  nameMin: 2,
  name: 100,
  email: 255,
  phone: 20,
  line: 180,
  city: 255,
  postalCode: 20,
  legalName: 180,
  /** The API caps company and VAT ids below the site form's 255. */
  companyId: 64,
} as const;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A loose phone check: the site validates with libphonenumber for CZ, which
 * the app doesn't ship; the server's check stays authoritative and answers
 * `contact.phone` when it disagrees.
 */
export function isPhoneNumber(phone: string): boolean {
  const digits = phone.replace(/[\s().-]/g, "");
  return /^\+?\d{9,15}$/.test(digits);
}

type Check = (value: string) => FieldProblem | undefined;

const required: Check = (value) => (value === "" ? "required" : undefined);
const maxLength =
  (maximum: number): Check =>
  (value) =>
    value.length > maximum ? "too_long" : undefined;
const minLength =
  (minimum: number): Check =>
  (value) =>
    value.length < minimum ? "too_short" : undefined;
const email: Check = (value) =>
  emailPattern.test(value) ? undefined : "invalid_email";
const phone: Check = (value) =>
  isPhoneNumber(value) ? undefined : "invalid_phone";
const country: Check = (value) =>
  invoiceCountryCodes.includes(value) ? undefined : "invalid_country";

const firstProblem = (value: string, checks: ReadonlyArray<Check>) =>
  checks.reduce<FieldProblem | undefined>(
    (found, check) => found ?? check(value),
    undefined
  );

const nameChecks = [
  required,
  minLength(limits.nameMin),
  maxLength(limits.name),
];
const emailChecks = [required, maxLength(limits.email), email];
const phoneChecks = [required, maxLength(limits.phone), phone];

const trimAll = <Fields extends { readonly [Key in keyof Fields]: string }>(
  fields: Fields
) =>
  Object.fromEntries(
    Object.entries<string>(fields).map(([key, value]) => [key, value.trim()])
  ) as { readonly [Key in keyof Fields]: string };

interface ContactInput {
  readonly contact: CheckoutDetails["contact"];
  readonly problems: DetailsFieldProblems;
}

const selfContactInput = (
  self: SelfContact,
  draft: DetailsDraft
): ContactInput => {
  const entered = trimAll(draft.self);
  const name = Option.getOrElse(self.name, () => entered.name);
  const phoneNumber = Option.getOrElse(self.phone, () => entered.phone);
  return {
    contact: { name, email: self.email, phone: phoneNumber },
    problems: {
      ...(Option.isNone(self.name) && { name: firstProblem(name, nameChecks) }),
      ...(Option.isNone(self.phone) && {
        phone: firstProblem(phoneNumber, phoneChecks),
      }),
    },
  };
};

const someoneElseInput = (draft: DetailsDraft): ContactInput => {
  const entered = trimAll(draft.someoneElse);
  return {
    contact: { name: entered.name, email: entered.email, phone: entered.phone },
    problems: {
      name: firstProblem(entered.name, nameChecks),
      email: firstProblem(entered.email, emailChecks),
      phone: firstProblem(entered.phone, phoneChecks),
    },
  };
};

interface BillingInput {
  readonly billing: CheckoutDetails["billing"];
  readonly problems: DetailsFieldProblems;
}

const addressInput = (draft: AddressDraft) => {
  const address = trimAll(draft);
  return {
    address,
    problems: {
      "address.line1": firstProblem(address.line1, [
        required,
        maxLength(limits.line),
      ]),
      "address.city": firstProblem(address.city, [
        required,
        maxLength(limits.city),
      ]),
      "address.postalCode": firstProblem(address.postalCode, [
        required,
        maxLength(limits.postalCode),
      ]),
      "address.country": firstProblem(address.country, [country]),
    } satisfies DetailsFieldProblems,
  };
};

/**
 * Whether "Invoice to me" asks for an address: only without a complete
 * saved one, which it then uses as it is.
 */
export const asksPersonalAddress = (saved: SavedBilling) =>
  Option.isNone(saved.address);

const billingInput = (
  saved: SavedBilling,
  draft: DetailsDraft
): BillingInput => {
  switch (draft.billing) {
    case "none":
      return {
        billing: { purpose: "personal", invoice: "none" },
        problems: {},
      };
    case "personal-invoice": {
      const { address, problems } = Option.match(saved.address, {
        onNone: () => addressInput(draft.personalAddress),
        onSome: (savedAddress) => ({ address: savedAddress, problems: {} }),
      });
      return {
        billing: { purpose: "personal", invoice: "requested", address },
        problems,
      };
    }
    case "business": {
      const { address, problems } = addressInput(draft.company.address);
      const buyer = trimAll({
        legalName: draft.company.legalName,
        companyId: draft.company.companyId,
        vatId: draft.company.vatId,
      });
      return {
        billing: {
          purpose: "business",
          invoice: "required",
          buyer: {
            kind: "business",
            legalName: buyer.legalName,
            companyId: buyer.companyId,
            ...(buyer.vatId !== "" && { vatId: buyer.vatId }),
            address,
          },
        },
        problems: {
          ...problems,
          "buyer.legalName": firstProblem(buyer.legalName, [
            required,
            maxLength(limits.legalName),
          ]),
          "buyer.companyId": firstProblem(buyer.companyId, [
            required,
            maxLength(limits.companyId),
          ]),
          "buyer.vatId": firstProblem(buyer.vatId, [
            maxLength(limits.companyId),
          ]),
        },
      };
    }
  }
};

const presentProblems = (
  problems: DetailsFieldProblems
): DetailsFieldProblems =>
  Object.fromEntries(
    Object.entries(problems).filter(([, problem]) => problem !== undefined)
  );

/**
 * Checks the form as the site does and builds what create checkout sends.
 * Only the fields on show are checked. Marketing consent is asked only when
 * booking for oneself and sent only when ticked.
 */
export function validateDetails(
  { self, saved }: DetailsProfile,
  draft: DetailsDraft
): DetailsValidation {
  const contactInput =
    draft.bookingFor === "self"
      ? selfContactInput(self, draft)
      : someoneElseInput(draft);
  const { billing, problems: billingProblems } = billingInput(saved, draft);
  const problems = presentProblems({
    ...contactInput.problems,
    ...billingProblems,
  });
  if (Object.keys(problems).length > 0) {
    return { _tag: "Invalid", problems };
  }
  return {
    _tag: "Valid",
    details: {
      bookingFor: draft.bookingFor,
      contact: contactInput.contact,
      billing,
      ...(draft.bookingFor === "self" &&
        draft.marketingConsent && { marketingConsent: true }),
    },
  };
}

const serverFields: ReadonlyMap<string, DetailsField> = new Map([
  ["contact.name", "name"],
  ["contact.email", "email"],
  ["contact.phone", "phone"],
  ["billing.address.line1", "address.line1"],
  ["billing.address.city", "address.city"],
  ["billing.address.postalCode", "address.postalCode"],
  ["billing.address.country", "address.country"],
  ["billing.buyer.legalName", "buyer.legalName"],
  ["billing.buyer.companyId", "buyer.companyId"],
  ["billing.buyer.vatId", "buyer.vatId"],
  ["billing.buyer.address.line1", "address.line1"],
  ["billing.buyer.address.city", "address.city"],
  ["billing.buyer.address.postalCode", "address.postalCode"],
  ["billing.buyer.address.country", "address.country"],
]);

/**
 * The form field a server `CustomerCheckoutDetailsInvalid.field` names;
 * none for a field the form doesn't show (such as plain `billing`).
 */
export const detailsFieldOf = (
  serverField: Option.Option<string>
): Option.Option<DetailsField> =>
  serverField.pipe(
    Option.flatMap((field) => Option.fromUndefinedOr(serverFields.get(field)))
  );
