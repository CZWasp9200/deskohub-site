import { describe, expect, test } from "bun:test";
import type { DotyposCustomer } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import {
  describeAdministrationCustomer,
  nameAdministrationCustomer,
} from "./customer-identity";
import { unnamedCustomerDisplayName } from "./customer-name";

const email = testEmailAddress("customer-identity");
const phone = "+420000000001";

const customer = (fields: Partial<DotyposCustomer>): DotyposCustomer =>
  ({ id: "customer-1", deleted: false, ...fields }) as DotyposCustomer;

const named = (displayName: string) => ({ displayName, hasName: true });
const unnamed = { displayName: unnamedCustomerDisplayName, hasName: false };

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
    expect(nameAdministrationCustomer(input)).toEqual(expected);
  });

  test("trims each part and joins first and last name with one space", () => {
    expect(
      nameAdministrationCustomer(
        customer({ firstName: " Synthetic ", lastName: " Person " })
      )
    ).toEqual(named("Synthetic Person"));
    expect(
      nameAdministrationCustomer(
        customer({ companyName: " Synthetic Company " })
      )
    ).toEqual(named("Synthetic Company"));
    expect(
      nameAdministrationCustomer(customer({ email: ` ${email} ` }))
    ).toEqual(named(email));
    expect(
      nameAdministrationCustomer(customer({ phone: ` ${phone} ` }))
    ).toEqual(named(phone));
  });

  test("skips whitespace-only parts", () => {
    expect(
      nameAdministrationCustomer(
        customer({ firstName: " ", lastName: "Person", companyName: "Company" })
      )
    ).toEqual(named("Person"));
    expect(
      nameAdministrationCustomer(
        customer({ firstName: " ", lastName: "\t", companyName: " ", phone })
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
        })
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
        })
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
        customer({ firstName: "Synthetic", email: " ", phone: "" })
      )
    ).toMatchObject({ email: null, phone: null });
  });
});
