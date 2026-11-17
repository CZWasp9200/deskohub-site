import { describe, expect, test } from "bun:test";
import type { DotyposCustomer } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import {
  describeAdministrationCustomer,
  nameAdministrationCustomer,
} from "./customer-identity";
import {
  inactiveCustomerDisplayNames,
  unnamedCustomerDisplayName,
} from "./customer-name";

const email = testEmailAddress("customer-identity");
const phone = "+420000000001";

const customer = (fields: Partial<DotyposCustomer>): DotyposCustomer =>
  ({ id: "customer-1", deleted: false, ...fields }) as DotyposCustomer;

const now = new Date("2026-11-17T12:00:00Z");
const past = "2026-11-17T11:59:59Z";
const future = "2026-11-17T12:00:01Z";

const named = (displayName: string) => ({
  displayName,
  hasName: true,
  lifecycle: "active",
});
const unnamed = {
  displayName: unnamedCustomerDisplayName,
  hasName: false,
  lifecycle: "active",
};

describe("nameAdministrationCustomer", () => {
  test.each([
    [
      "the person before the company, email and phone",
      customer({
        firstName: "Synthetic",
        lastName: "Person",
        companyName: "Synthetic Company",
        email,
        phone,
      }),
      named("Synthetic Person"),
    ],
    [
      "a first name alone",
      customer({ firstName: "Synthetic", companyName: "Synthetic Company" }),
      named("Synthetic"),
    ],
    [
      "a last name alone",
      customer({ lastName: "Person", email }),
      named("Person"),
    ],
    [
      "the company without a person",
      customer({ companyName: "Synthetic Company", email, phone }),
      named("Synthetic Company"),
    ],
    [
      "the email without a person or company",
      customer({ email, phone }),
      named(email),
    ],
    ["the phone alone", customer({ phone }), named(phone)],
    ["nobody without any part", customer({}), unnamed],
  ])("names %s", (_, input, expected) => {
    expect(nameAdministrationCustomer(input, now)).toEqual(expected);
  });

  test("trims each part and joins first and last name with one space", () => {
    expect(
      nameAdministrationCustomer(
        customer({ firstName: " Synthetic ", lastName: " Person " }),
        now
      )
    ).toEqual(named("Synthetic Person"));
    expect(
      nameAdministrationCustomer(
        customer({ companyName: " Synthetic Company " }),
        now
      )
    ).toEqual(named("Synthetic Company"));
    expect(
      nameAdministrationCustomer(customer({ email: ` ${email} ` }), now)
    ).toEqual(named(email));
    expect(
      nameAdministrationCustomer(customer({ phone: ` ${phone} ` }), now)
    ).toEqual(named(phone));
  });

  test("skips whitespace-only parts", () => {
    expect(
      nameAdministrationCustomer(
        customer({
          firstName: " ",
          lastName: "Person",
          companyName: "Company",
        }),
        now
      )
    ).toEqual(named("Person"));
    expect(
      nameAdministrationCustomer(
        customer({ firstName: " ", lastName: "\t", companyName: " ", phone }),
        now
      )
    ).toEqual(named(phone));
    expect(
      nameAdministrationCustomer(
        customer({
          firstName: " ",
          lastName: " ",
          companyName: " ",
          email: " ",
          phone: " ",
        }),
        now
      )
    ).toEqual(unnamed);
  });
});

describe("describeAdministrationCustomer", () => {
  test("names the customer and trims the contact details", () => {
    expect(
      describeAdministrationCustomer(
        customer({
          companyName: "Synthetic Company",
          email: ` ${email} `,
          phone,
        }),
        now
      )
    ).toEqual({
      id: "customer-1",
      ...named("Synthetic Company"),
      email,
      phone,
    });
  });

  test("leaves empty contact details null", () => {
    expect(
      describeAdministrationCustomer(
        customer({ firstName: "Synthetic", email: " ", phone: "" }),
        now
      )
    ).toMatchObject({ email: null, phone: null });
  });
});

describe("a deleted or expired customer", () => {
  const person = {
    firstName: "Synthetic",
    lastName: "Person",
    email,
    phone,
  } satisfies Partial<DotyposCustomer>;

  test.each([
    ["deleted", customer({ ...person, deleted: true })],
    ["expired", customer({ ...person, expireDate: past })],
    ["expired", customer({ ...person, expireDate: now.toISOString() })],
    ["deleted", customer({ ...person, deleted: true, expireDate: past })],
  ] as const)(
    "is %s: a placeholder name and no contact details",
    (lifecycle, input) => {
      expect(nameAdministrationCustomer(input, now)).toEqual({
        displayName: inactiveCustomerDisplayNames[lifecycle],
        hasName: false,
        lifecycle,
      });
      expect(describeAdministrationCustomer(input, now)).toEqual({
        id: "customer-1",
        displayName: inactiveCustomerDisplayNames[lifecycle],
        hasName: false,
        lifecycle,
        email: null,
        phone: null,
      });
    }
  );

  test("is judged at the time it was read", () => {
    const expiring = customer({ ...person, expireDate: future });
    expect(describeAdministrationCustomer(expiring, now)).toMatchObject({
      ...named("Synthetic Person"),
      email,
      phone,
    });
    expect(
      describeAdministrationCustomer(expiring, new Date(future))
    ).toMatchObject({ hasName: false, lifecycle: "expired", email: null });
  });
});
