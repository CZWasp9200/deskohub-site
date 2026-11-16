import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  invoiceBuyerSchema,
  toDotyposCustomerBillingDetails,
} from "./billing-identity";

const decodeBuyer = Schema.decodeUnknownSync(invoiceBuyerSchema);

const address = {
  line1: "Synthetic street 1",
  city: "Prague",
  postalCode: "100 00",
  country: "CZ",
};

describe("Dotypos customer billing details", () => {
  test("clear a person buyer's company fields and an absent second address line", () => {
    expect(
      toDotyposCustomerBillingDetails(
        decodeBuyer({
          kind: "person",
          legalName: "Synthetic Customer",
          address,
        })
      )
    ).toEqual({
      addressLine1: "Synthetic street 1",
      addressLine2: "",
      city: "Prague",
      zip: "100 00",
      country: "CZ",
      companyName: "",
      companyId: "",
      vatId: "",
    });
  });

  test("hold a business buyer's legal name, company and VAT ids", () => {
    expect(
      toDotyposCustomerBillingDetails(
        decodeBuyer({
          kind: "business",
          legalName: "Synthetic Company s.r.o.",
          companyId: "12345678",
          vatId: "CZ12345678",
          address: { ...address, line2: "Unit 2", country: "SK" },
        })
      )
    ).toEqual({
      addressLine1: "Synthetic street 1",
      addressLine2: "Unit 2",
      city: "Prague",
      zip: "100 00",
      country: "SK",
      companyName: "Synthetic Company s.r.o.",
      companyId: "12345678",
      vatId: "CZ12345678",
    });
  });

  test("clear an absent VAT id of a business buyer", () => {
    expect(
      toDotyposCustomerBillingDetails(
        decodeBuyer({
          kind: "business",
          legalName: "Synthetic Company s.r.o.",
          companyId: "12345678",
          address,
        })
      )
    ).toMatchObject({ companyId: "12345678", vatId: "" });
  });
});
