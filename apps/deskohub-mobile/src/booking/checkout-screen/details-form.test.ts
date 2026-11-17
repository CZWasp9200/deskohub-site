import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type {
  CustomerAccountState,
  CustomerProfileBilling,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { sampleWorkspaceData } from "../../customer-api/testing/sample-fixtures";
import {
  type DetailsDraft,
  type DetailsProfile,
  detailsAccess,
  detailsFieldOf,
  initialDetailsDraft,
  orderedProblems,
  problemsAfterChange,
  type SavedBilling,
  type SelfContact,
  savedBillingOf,
  validateDetails,
  withRejectedSavedFields,
} from "./details-form";

const linkedAccount = (
  profile: Partial<Extract<CustomerAccountState, { kind: "linked" }>["profile"]>
): CustomerAccountState => {
  const account = sampleWorkspaceData("linked").account;
  if (account.kind !== "linked") throw new Error("sample isn't linked");
  return { ...account, profile: { ...account.profile, ...profile } };
};

const noSaved: SavedBilling = {
  address: Option.none(),
  company: Option.none(),
};

const profileSelf: SelfContact = {
  email: testEmailAddress("booker"),
  name: Option.some("Synthetic Booker"),
  phone: Option.some("+420 700 000 000"),
};

const as = (
  self: SelfContact,
  saved: SavedBilling = noSaved
): DetailsProfile => ({ self, saved });

const draft = (patch: Partial<DetailsDraft> = {}): DetailsDraft => ({
  ...initialDetailsDraft(noSaved, "CZ"),
  ...patch,
});

const address = {
  line1: " Vodičkova 1 ",
  city: "Praha",
  postalCode: "110 00",
  country: "CZ",
};

const billing = (
  patch: Partial<CustomerProfileBilling>
): CustomerProfileBilling => ({
  kind: "personal",
  addressLine1: null,
  addressLine2: null,
  city: null,
  zip: null,
  country: null,
  companyName: null,
  companyId: null,
  vatId: null,
  ...patch,
});

const problemsOf = (self: SelfContact, form: DetailsDraft) => {
  const validation = validateDetails(as(self), form);
  return validation._tag === "Invalid" ? validation.problems : {};
};

describe("detailsAccess", () => {
  test("a linked profile books as itself, asking for a phone it lacks", () => {
    const access = detailsAccess(
      linkedAccount({ firstName: " Jana ", lastName: "Nováková", phone: null })
    );
    expect(access._tag).toBe("Ready");
    if (access._tag !== "Ready") return;
    expect(access.self.name).toEqual(Option.some("Jana Nováková"));
    expect(Option.isNone(access.self.phone)).toBe(true);
  });

  test("an invalid saved phone is asked for again", () => {
    const access = detailsAccess(linkedAccount({ phone: "12" }));
    expect(access._tag === "Ready" && Option.isNone(access.self.phone)).toBe(
      true
    );
  });

  test("an account without a profile enters its name and phone", () => {
    const access = detailsAccess(
      sampleWorkspaceData("completion-required").account
    );
    expect(access._tag).toBe("Ready");
    if (access._tag !== "Ready") return;
    expect(Option.isNone(access.self.name)).toBe(true);
    expect(Option.isNone(access.self.phone)).toBe(true);
  });

  test("support and deletion states can't book", () => {
    expect(
      detailsAccess(sampleWorkspaceData("support-required").account)
    ).toEqual({
      _tag: "Unavailable",
      reason: "support-required",
    });
    expect(
      detailsAccess(sampleWorkspaceData("deletion-pending").account)._tag
    ).toBe("Unavailable");
  });
});

describe("validateDetails", () => {
  test("self with a full profile sends the profile's contact and no invoice", () => {
    expect(validateDetails(as(profileSelf), draft())).toEqual({
      _tag: "Valid",
      details: {
        bookingFor: "self",
        contact: {
          name: "Synthetic Booker",
          email: testEmailAddress("booker"),
          phone: "+420 700 000 000",
        },
        billing: { purpose: "personal", invoice: "none" },
      },
    });
  });

  test("marketing consent is sent only when ticked, and only for oneself", () => {
    const ticked = validateDetails(
      as(profileSelf),
      draft({ marketingConsent: true })
    );
    expect(ticked._tag === "Valid" && ticked.details.marketingConsent).toBe(
      true
    );
    const forSomeoneElse = validateDetails(
      as(profileSelf),
      draft({
        bookingFor: "someone-else",
        marketingConsent: true,
        someoneElse: {
          name: "Guest Person",
          email: testEmailAddress("guest"),
          phone: "777 123 456",
        },
      })
    );
    expect(forSomeoneElse._tag).toBe("Valid");
    if (forSomeoneElse._tag !== "Valid") return;
    expect("marketingConsent" in forSomeoneElse.details).toBe(false);
    expect(forSomeoneElse.details.contact.email).toBe(
      testEmailAddress("guest")
    );
  });

  test("a missing self phone is required, then checked", () => {
    const noPhone = { ...profileSelf, phone: Option.none() };
    expect(problemsOf(noPhone, draft())).toEqual({ phone: "required" });
    expect(
      problemsOf(noPhone, draft({ self: { name: "", phone: "12ab" } }))
    ).toEqual({ phone: "invalid_phone" });
    const entered = validateDetails(
      as(noPhone),
      draft({ self: { name: "", phone: " 777 123 456 " } })
    );
    expect(entered._tag === "Valid" && entered.details.contact.phone).toBe(
      "777 123 456"
    );
  });

  test("an unprofiled account must name itself", () => {
    const unprofiled = {
      email: testEmailAddress("new"),
      name: Option.none(),
      phone: Option.none(),
    };
    expect(
      problemsOf(unprofiled, draft({ self: { name: "J", phone: "777123456" } }))
    ).toEqual({ name: "too_short" });
  });

  test("someone else needs a name, one email and a phone", () => {
    expect(
      problemsOf(profileSelf, draft({ bookingFor: "someone-else" }))
    ).toEqual({ name: "required", email: "required", phone: "required" });
    expect(
      problemsOf(
        profileSelf,
        draft({
          bookingFor: "someone-else",
          someoneElse: {
            name: "Guest Person",
            email: "guest@example",
            phone: "777123456",
          },
        })
      )
    ).toEqual({ email: "invalid_email" });
  });

  test("a personal invoice without a saved address asks for one, sent trimmed", () => {
    expect(
      problemsOf(profileSelf, draft({ billing: "personal-invoice" }))
    ).toEqual({
      "address.line1": "required",
      "address.city": "required",
      "address.postalCode": "required",
    });
    const valid = validateDetails(
      as(profileSelf),
      draft({ billing: "personal-invoice", personalAddress: address })
    );
    expect(valid._tag === "Valid" && valid.details.billing).toEqual({
      purpose: "personal",
      invoice: "requested",
      address: {
        line1: "Vodičkova 1",
        city: "Praha",
        postalCode: "110 00",
        country: "CZ",
      },
    });
  });

  test("a personal invoice uses the saved address as it is, whatever was typed", () => {
    const saved = {
      ...noSaved,
      address: Option.some({ ...address, line1: "Křižíkova 12" }),
    };
    const valid = validateDetails(
      as(profileSelf, saved),
      draft({ billing: "personal-invoice" })
    );
    expect(valid._tag === "Valid" && valid.details.billing).toEqual({
      purpose: "personal",
      invoice: "requested",
      address: { ...address, line1: "Křižíkova 12" },
    });
  });

  test("a business invoice needs the buyer; the VAT id is optional and capped", () => {
    const company = (patch: Partial<DetailsDraft["company"]>) => ({
      legalName: "",
      companyId: "",
      vatId: "",
      address,
      ...patch,
    });
    expect(
      problemsOf(
        profileSelf,
        draft({ billing: "business", company: company({}) })
      )
    ).toEqual({ "buyer.legalName": "required", "buyer.companyId": "required" });
    expect(
      problemsOf(
        profileSelf,
        draft({
          billing: "business",
          company: company({
            legalName: "Firma s.r.o.",
            companyId: "1".repeat(65),
            address: { ...address, country: "" },
          }),
        })
      )
    ).toEqual({
      "address.country": "invalid_country",
      "buyer.companyId": "too_long",
    });
    const valid = validateDetails(
      as(profileSelf),
      draft({
        billing: "business",
        company: company({ legalName: "Firma s.r.o.", companyId: "12345678" }),
      })
    );
    expect(valid._tag === "Valid" && valid.details.billing).toEqual({
      purpose: "business",
      invoice: "required",
      buyer: {
        kind: "business",
        legalName: "Firma s.r.o.",
        companyId: "12345678",
        address: {
          line1: "Vodičkova 1",
          city: "Praha",
          postalCode: "110 00",
          country: "CZ",
        },
      },
    });
  });

  test("only the chosen invoice's fields are checked", () => {
    const leftOver = draft({
      billing: "none",
      company: {
        legalName: "",
        companyId: "",
        vatId: "",
        address: { ...address, line1: "" },
      },
    });
    expect(validateDetails(as(profileSelf), leftOver)._tag).toBe("Valid");
  });
});

describe("problemsAfterChange (stale errors, board 31)", () => {
  const submitted = {
    "address.line1": "required",
    "address.city": "required",
    "buyer.legalName": "required",
    phone: "invalid_phone",
  } as const;

  test("switching the invoice type clears every invoice field's problem", () => {
    expect(problemsAfterChange(submitted, { _tag: "Billing" })).toEqual({
      phone: "invalid_phone",
    });
  });

  test("switching who the booking is for clears the contact's problems", () => {
    expect(problemsAfterChange(submitted, { _tag: "BookingFor" })).toEqual({
      "address.line1": "required",
      "address.city": "required",
      "buyer.legalName": "required",
    });
  });

  test("typing in a field clears only that field's problem", () => {
    expect(
      problemsAfterChange(submitted, { _tag: "Field", field: "address.city" })
    ).toEqual({
      "address.line1": "required",
      "buyer.legalName": "required",
      phone: "invalid_phone",
    });
  });

  test("an applied company lookup clears the problems of the fields it filled", () => {
    expect(
      problemsAfterChange(submitted, {
        _tag: "Fields",
        fields: ["buyer.legalName", "address.city"],
      })
    ).toEqual({ "address.line1": "required", phone: "invalid_phone" });
  });

  test("problems are counted and brought into view in screen order", () => {
    expect(orderedProblems(submitted).map(({ field }) => field)).toEqual([
      "phone",
      "buyer.legalName",
      "address.line1",
      "address.city",
    ]);
  });
});

describe("savedBillingOf", () => {
  test("offers a complete personal address", () => {
    const saved = savedBillingOf(
      billing({
        addressLine1: "Křižíkova 12",
        city: "Praha",
        zip: "186 00",
        country: "cz",
      })
    );
    expect(saved.address).toEqual(
      Option.some({
        line1: "Křižíkova 12",
        city: "Praha",
        postalCode: "186 00",
        country: "CZ",
      })
    );
    expect(Option.isNone(saved.company)).toBe(true);
  });

  test("an incomplete or unknown-country address isn't offered", () => {
    expect(
      Option.isNone(
        savedBillingOf(billing({ addressLine1: "Křižíkova 12", city: "Praha" }))
          .address
      )
    ).toBe(true);
    expect(
      Option.isNone(
        savedBillingOf(
          billing({
            addressLine1: "Křižíkova 12",
            city: "Praha",
            zip: "186 00",
            country: "Czechia",
          })
        ).address
      )
    ).toBe(true);
  });

  test("saved business details start the company form, not a personal invoice", () => {
    const saved = savedBillingOf(
      billing({
        kind: "business",
        companyName: "Firma s.r.o.",
        companyId: "12345678",
        city: "Brno",
      })
    );
    expect(Option.isNone(saved.address)).toBe(true);
    const start = initialDetailsDraft(saved, "AT");
    expect(start.billing).toBe("none");
    expect(start.company.legalName).toBe("Firma s.r.o.");
    expect(start.company.address.city).toBe("Brno");
    // Saved without a country, the address starts in the device's.
    expect(start.company.address.country).toBe("AT");
  });

  test("a saved business country is kept; new addresses start in the device's country", () => {
    const saved = savedBillingOf(
      billing({ kind: "business", companyName: "Firma s.r.o.", country: "sk" })
    );
    const start = initialDetailsDraft(saved, "AT");
    expect(start.company.address.country).toBe("SK");
    expect(start.personalAddress.country).toBe("AT");
    expect(
      initialDetailsDraft(
        { address: Option.none(), company: Option.none() },
        "PL"
      ).company.address.country
    ).toBe("PL");
  });
});

describe("withRejectedSavedFields", () => {
  test("a saved phone the server rejected is asked for and sent as entered", () => {
    const rejected = withRejectedSavedFields(profileSelf, new Set(["phone"]));
    expect(rejected.name).toEqual(profileSelf.name);
    expect(problemsOf(rejected, draft())).toEqual({ phone: "required" });
    const corrected = validateDetails(
      as(rejected),
      draft({ self: { name: "", phone: "+420 777 123 456" } })
    );
    expect(corrected._tag === "Valid" && corrected.details.contact.phone).toBe(
      "+420 777 123 456"
    );
  });

  test("a rejected saved name is asked for too", () => {
    const rejected = withRejectedSavedFields(profileSelf, new Set(["name"]));
    expect(Option.isNone(rejected.name)).toBe(true);
    expect(rejected.phone).toEqual(profileSelf.phone);
  });
});

describe("detailsFieldOf", () => {
  test("maps the server's field paths onto the form's fields", () => {
    expect(detailsFieldOf(Option.some("contact.phone"))).toEqual(
      Option.some("phone")
    );
    expect(detailsFieldOf(Option.some("billing.buyer.address.city"))).toEqual(
      Option.some("address.city")
    );
    expect(detailsFieldOf(Option.some("billing.address.country"))).toEqual(
      Option.some("address.country")
    );
    expect(Option.isNone(detailsFieldOf(Option.some("billing")))).toBe(true);
    expect(Option.isNone(detailsFieldOf(Option.some("constructor")))).toBe(
      true
    );
    expect(Option.isNone(detailsFieldOf(Option.none()))).toBe(true);
  });
});
