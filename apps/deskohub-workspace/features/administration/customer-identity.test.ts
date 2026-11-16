import { describe, expect, test } from "bun:test";
import type { DotyposCustomer } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type CustomerNamePrecedence,
  describeAdministrationCustomer,
  nameAdministrationCustomer,
} from "./customer-identity";
import { unnamedCustomerDisplayName } from "./customer-name";

const email = testEmailAddress("customer-identity");
const phone = "+420000000001";

const customer = (fields: Partial<DotyposCustomer>): DotyposCustomer =>
  ({ id: "customer-1", deleted: false, ...fields }) as DotyposCustomer;

const variants = {
  company: customer({
    companyName: " Synthetic Company ",
    firstName: "Synthetic",
    lastName: "Person",
    email,
    phone,
  }),
  person: customer({
    firstName: "Synthetic",
    lastName: "Person",
    email,
    phone,
  }),
  // Parts with their own whitespace: some rules trim only the joined name.
  spacedPerson: customer({ firstName: "Synthetic ", lastName: " Person" }),
  email: customer({ email: ` ${email} `, phone }),
  phone: customer({ phone: ` ${phone} ` }),
  none: customer({ firstName: " ", companyName: "", email: "" }),
} as const;

type Variant = keyof typeof variants;

/** The name each precedence gives each variant; `null` is unnamed. */
const expected = {
  "company-person-email-phone": {
    company: "Synthetic Company",
    person: "Synthetic Person",
    spacedPerson: "Synthetic   Person",
    email,
    phone,
    none: null,
  },
  "company-person-email": {
    company: "Synthetic Company",
    person: "Synthetic Person",
    spacedPerson: "Synthetic   Person",
    email,
    phone: null,
    none: null,
  },
  "person-company": {
    company: "Synthetic Person",
    person: "Synthetic Person",
    spacedPerson: "Synthetic Person",
    email: null,
    phone: null,
    none: null,
  },
} satisfies Record<CustomerNamePrecedence, Record<Variant, string | null>>;

describe("nameAdministrationCustomer", () => {
  for (const [precedence, names] of Object.entries(expected) as [
    CustomerNamePrecedence,
    Record<Variant, string | null>,
  ][]) {
    for (const [variant, name] of Object.entries(names) as [
      Variant,
      string | null,
    ][]) {
      test(`${precedence} names a ${variant} customer`, () => {
        expect(
          nameAdministrationCustomer(variants[variant], precedence)
        ).toEqual(
          name === null
            ? { displayName: unnamedCustomerDisplayName, hasName: false }
            : { displayName: name, hasName: true }
        );
      });
    }
  }

  test("person-company falls back to the company name", () => {
    expect(
      nameAdministrationCustomer(
        customer({ companyName: " Synthetic Company " }),
        "person-company"
      )
    ).toEqual({ displayName: "Synthetic Company", hasName: true });
  });
});

describe("describeAdministrationCustomer", () => {
  test("trims the contact details and leaves empty ones null", () => {
    expect(
      describeAdministrationCustomer(variants.email, "person-company")
    ).toEqual({
      id: "customer-1",
      displayName: unnamedCustomerDisplayName,
      hasName: false,
      email,
      phone,
    });
    expect(
      describeAdministrationCustomer(
        customer({ firstName: "Synthetic", email: " ", phone: "" }),
        "person-company"
      )
    ).toMatchObject({ email: null, phone: null });
  });
});
