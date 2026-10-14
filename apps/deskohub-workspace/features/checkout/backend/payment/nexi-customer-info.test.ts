import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { getNexiHostedPaymentCustomer } from "./nexi-customer-info";

const testEmailAddressForAda = testEmailAddress("ada");

describe("getNexiHostedPaymentCustomer", () => {
  test("maps Czech customer details to Nexi's split mobile fields", () => {
    expect(
      getNexiHostedPaymentCustomer({
        id: "dotypos-customer-id",
        name: "Ada Lovelace",
        email: testEmailAddressForAda,
        phone: "+420 777 777 777",
      })
    ).toEqual({
      id: "dotypos-customer-id",
      name: "Ada Lovelace",
      email: testEmailAddressForAda,
      mobilePhone: {
        countryCallingCode: "420",
        nationalNumber: "777777777",
      },
    });
  });
});
