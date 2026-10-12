import { describe, expect, test } from "bun:test";
import { getReservationCustomerQueryMode } from "./reservation-checkout-query";

describe("getReservationCustomerQueryMode", () => {
  test("honours an explicit customer parameter over contact fields", () => {
    expect(
      getReservationCustomerQueryMode({
        customer: "account",
        name: "Ada Lovelace",
      })
    ).toBe("account");
    expect(getReservationCustomerQueryMode({ customer: " contact " })).toBe(
      "contact"
    );
  });

  test("treats any contact field as a request for that exact contact", () => {
    expect(
      getReservationCustomerQueryMode(
        new URLSearchParams("phone=%2B420777777777")
      )
    ).toBe("contact");
    expect(getReservationCustomerQueryMode({ email: "invalid@" })).toBe(
      "contact"
    );
  });

  test("leaves the mode open without a customer or contact parameter", () => {
    expect(getReservationCustomerQueryMode({ tier: "plus" })).toBeUndefined();
    expect(
      getReservationCustomerQueryMode({ customer: "someone", name: "  " })
    ).toBeUndefined();
  });

  test("ignores contact fields on forms whose links never prefill them", () => {
    expect(
      getReservationCustomerQueryMode(
        { name: "Ada Lovelace" },
        { prefillsContact: false }
      )
    ).toBeUndefined();
    expect(
      getReservationCustomerQueryMode(
        { customer: "contact" },
        { prefillsContact: false }
      )
    ).toBe("contact");
  });
});
