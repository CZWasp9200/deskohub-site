import { describe, expect, test } from "bun:test";
import {
  CustomerAccountLinkRequired,
  type CustomerCompanyDetails,
  CustomerCompanyIdInvalid,
  CustomerCompanyNotFound,
  CustomerCompanyRegistryUnavailable,
  CustomerRateLimited,
  CustomerServiceUnavailable,
} from "@deskohub/workspace-customer-api";
import { Exit } from "effect";
import { sampleCompanies } from "../customer-api/testing/sample-fixtures";
import {
  appliedDetails,
  type CompanyDetailsField,
  type CompanyLookupFailure,
  CompanyLookupState,
  lookupAction,
  lookupAfterEdit,
  lookupApplied,
  lookupSettled,
  lookupStarted,
  lookupStatus,
} from "./company-lookup-model";

const locale = "en-US";
const withVat = sampleCompanies.get("12345679") as CustomerCompanyDetails;
const withoutVat = sampleCompanies.get("00000019") as CustomerCompanyDetails;
const allFields: ReadonlyArray<CompanyDetailsField> = [
  "companyName",
  "companyId",
  "vatId",
  "addressLine1",
  "addressLine2",
  "city",
  "zip",
  "country",
];

const refusedBy = (failure: CompanyLookupFailure) =>
  lookupSettled("12345679", Exit.fail(failure));

const refusalTag = (state: CompanyLookupState) =>
  state._tag === "Refused" ? state.refusal._tag : undefined;

describe("lookupStarted", () => {
  test("an empty field asks no registry and says the ID is invalid", () => {
    for (const typed of ["", "   "]) {
      const state = lookupStarted(typed);
      expect(state._tag).toBe("Refused");
      expect(refusalTag(state)).toBe("InvalidId");
    }
  });

  test("a typed ID is looked up trimmed; its format is the server's to judge", () => {
    expect(lookupStarted(" 1234 ")).toEqual(
      CompanyLookupState.LookingUp({ companyId: "1234" })
    );
  });
});

describe("lookupSettled: each server outcome to its state", () => {
  test("a found company waits for review, nothing applied", () => {
    expect(lookupSettled("12345679", Exit.succeed(withVat))).toEqual(
      CompanyLookupState.Found({ companyId: "12345679", company: withVat })
    );
  });

  test("the lookup's own refusals keep their own states", () => {
    expect(refusalTag(refusedBy(new CustomerCompanyIdInvalid()))).toBe(
      "InvalidId"
    );
    expect(refusalTag(refusedBy(new CustomerCompanyNotFound()))).toBe(
      "NotFound"
    );
    expect(
      refusalTag(refusedBy(new CustomerCompanyRegistryUnavailable()))
    ).toBe("RegistryUnavailable");
  });

  test("request failures keep the app's view error", () => {
    const viewError = (state: CompanyLookupState) =>
      state._tag === "Refused" && state.refusal._tag === "RequestFailed"
        ? state.refusal.error
        : undefined;
    expect(viewError(refusedBy(new CustomerRateLimited()))?._tag).toBe(
      "RateLimited"
    );
    expect(viewError(refusedBy(new CustomerServiceUnavailable()))?._tag).toBe(
      "Unavailable"
    );
    expect(
      viewError(
        refusedBy(
          new CustomerAccountLinkRequired({ reason: "deletion-pending" })
        )
      )
    ).toEqual({ _tag: "LinkRequired", reason: "deletion-pending" });
    expect(
      viewError(lookupSettled("12345679", Exit.die(new Error("defect"))))?._tag
    ).toBe("Unexpected");
  });
});

describe("lookupAction", () => {
  test("Try again where trying again can help, else Look up", () => {
    expect(lookupAction(CompanyLookupState.Idle())).toBe("look-up");
    expect(lookupAction(refusedBy(new CustomerCompanyNotFound()))).toBe(
      "retry"
    );
    expect(
      lookupAction(refusedBy(new CustomerCompanyRegistryUnavailable()))
    ).toBe("retry");
    expect(lookupAction(refusedBy(new CustomerServiceUnavailable()))).toBe(
      "retry"
    );
    expect(lookupAction(refusedBy(new CustomerCompanyIdInvalid()))).toBe(
      "look-up"
    );
    // The rate limit says to wait; the button stays for a later lookup.
    expect(lookupAction(refusedBy(new CustomerRateLimited()))).toBe("look-up");
  });
});

describe("lookupStatus", () => {
  const tone = (state: CompanyLookupState, remindsToSave = true) =>
    lookupStatus(state, { remindsToSave, locale })?.tone;

  test("nothing under the button before an outcome", () => {
    expect(tone(CompanyLookupState.Idle())).toBeUndefined();
    expect(
      tone(CompanyLookupState.LookingUp({ companyId: "12345679" }))
    ).toBeUndefined();
  });

  test("found and applied are affirmative; applied only with a Save button", () => {
    const found = lookupSettled("12345679", Exit.succeed(withVat));
    expect(tone(found)).toBe("positive");
    const applied = CompanyLookupState.Applied({ companyId: "12345679" });
    expect(tone(applied, true)).toBe("positive");
    expect(tone(applied, false)).toBeUndefined();
  });

  test("every refusal is an error with a message", () => {
    for (const failure of [
      new CustomerCompanyIdInvalid(),
      new CustomerCompanyNotFound(),
      new CustomerCompanyRegistryUnavailable(),
      new CustomerRateLimited(),
      new CustomerAccountLinkRequired({ reason: "deletion-pending" }),
    ]) {
      const status = lookupStatus(refusedBy(failure), {
        remindsToSave: true,
        locale,
      });
      expect(status?.tone).toBe("danger");
      expect(status?.message).not.toBe("");
    }
  });
});

describe("appliedDetails", () => {
  test("fills exactly the returned fields the form has", () => {
    expect(appliedDetails(withVat, allFields)).toEqual(withVat);
    expect(
      appliedDetails(withVat, ["companyName", "companyId", "city"])
    ).toEqual({
      companyName: withVat.companyName,
      companyId: withVat.companyId,
      city: withVat.city,
    });
  });

  test("a detail the registry lacks is left out, so the typed value stays", () => {
    const applied = appliedDetails(withoutVat, allFields);
    expect(Object.keys(applied)).not.toContain("vatId");
    expect(Object.keys(applied)).not.toContain("addressLine2");
    expect({ vatId: "CZ typed", ...applied }.vatId).toBe("CZ typed");
  });
});

describe("lookupAfterEdit: typing by hand stays possible in every state", () => {
  const states = [
    CompanyLookupState.LookingUp({ companyId: "12345679" }),
    lookupSettled("12345679", Exit.succeed(withVat)),
    lookupApplied({ companyId: "12345679", company: withVat }, allFields),
    refusedBy(new CustomerCompanyNotFound()),
    refusedBy(new CustomerCompanyRegistryUnavailable()),
    refusedBy(new CustomerRateLimited()),
  ];

  test("the state shows while the field holds its ID", () => {
    for (const state of states) {
      expect(lookupAfterEdit(state, " 12345679 ")).toBe(state);
    }
  });

  test("another typed ID returns the field to idle, ready to look up", () => {
    for (const state of states) {
      const shown = lookupAfterEdit(state, "87654321");
      expect(shown._tag).toBe("Idle");
      expect(lookupAction(shown)).toBe("look-up");
      // Typing the old ID back finds nothing left to show.
      expect(lookupAfterEdit(shown, "12345679")._tag).toBe("Idle");
    }
  });

  test("applied belongs to the ID the registry put in the field", () => {
    const company = { ...withVat, companyId: "00000019" };
    expect(
      lookupApplied({ companyId: " 12345679", company }, allFields)
    ).toEqual(CompanyLookupState.Applied({ companyId: "00000019" }));
    expect(
      lookupApplied({ companyId: "12345679", company }, ["companyName"])
    ).toEqual(CompanyLookupState.Applied({ companyId: "12345679" }));
  });
});
