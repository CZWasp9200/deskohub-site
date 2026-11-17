import { describe, expect, test } from "bun:test";
import { Option, Result } from "effect";
import { sampleProfile } from "../../customer-api/testing/sample-fixtures";
import {
  identityFields,
  type ProfileDraft,
  profileDraftOf,
  validateProfileDraft,
} from "../profile/profile-draft";
import { profileFooterView } from "../profile/profile-footer-view";
import {
  currentDraft,
  type EditedProfile,
  editedDraft,
  ProfileSubmitState,
} from "../profile/profile-save";
import { billingFormView } from "./billing-form-model";

const phoneRegion = "CZ";
const business: EditedProfile = {
  profile: sampleProfile,
  phoneRegion,
  deviceCountry: "CZ",
};
const withoutBilling: EditedProfile = {
  profile: { ...sampleProfile, billing: null },
  phoneRegion,
  deviceCountry: "CZ",
};

/** The draft after each change in turn, as the form applies them. */
const afterChanges = (
  edited: EditedProfile,
  ...changes: ReadonlyArray<Partial<ProfileDraft>>
) =>
  currentDraft(
    changes.reduce(
      (edits, change) => editedDraft(edits, edited, change),
      Option.none<ProfileDraft>()
    ),
    edited
  );

describe("billingFormView", () => {
  test("each choice shows its sections and fields", () => {
    const view = (billingKind: ProfileDraft["billingKind"]) =>
      billingFormView(sampleProfile, afterChanges(business, { billingKind }));

    expect(view("none")).toMatchObject({ company: false, address: false });
    expect(view("none").fields).toEqual([]);
    expect(view("personal")).toMatchObject({ company: false, address: true });
    expect(view("personal").fields).not.toContain("companyName");
    expect(view("business")).toMatchObject({ company: true, address: true });
    expect(view("business").fields).toEqual(
      expect.arrayContaining(["companyName", "companyId", "vatId", "country"])
    );
  });

  test("switching to Personal and back keeps the company details in the draft", () => {
    const saved = profileDraftOf(sampleProfile, phoneRegion, "CZ");
    const back = afterChanges(
      business,
      { billingKind: "personal" },
      { city: "Othertown" },
      { billingKind: "business" }
    );

    expect(back).toMatchObject({
      billingKind: "business",
      companyName: saved.companyName,
      companyId: saved.companyId,
      vatId: saved.vatId,
      city: "Othertown",
    });
  });

  test("a Personal save leaves the kept company details out", () => {
    const personal = afterChanges(business, { billingKind: "personal" });

    const save = Result.getOrThrow(validateProfileDraft(personal, phoneRegion));

    expect(save.billing?.kind).toBe("personal");
    expect(save.billing).not.toHaveProperty("companyName");
  });

  test("warns only when No billing details would remove saved ones", () => {
    const removes = (edited: EditedProfile, change: Partial<ProfileDraft>) =>
      billingFormView(edited.profile, afterChanges(edited, change))
        .removesSavedBilling;

    expect(removes(business, { billingKind: "none" })).toBe(true);
    expect(removes(business, { billingKind: "personal" })).toBe(false);
    expect(removes(withoutBilling, { billingKind: "none" })).toBe(false);
    expect(removes(withoutBilling, { billingKind: "business" })).toBe(false);
  });
});

describe("billing field errors", () => {
  // The contract's own profile schema, as the Workspace decodes the save.
  const refused = (change: Partial<ProfileDraft>) => {
    const draft = afterChanges(business, change);
    const result = validateProfileDraft(draft, phoneRegion);
    if (Result.isSuccess(result)) throw new Error("the draft is valid");
    return { draft, invalid: result.failure };
  };

  test("each refused billing field gets its own problem, the first in screen order", () => {
    const { invalid } = refused({ companyName: " ", city: "x".repeat(101) });

    expect(invalid.fields).toEqual({
      companyName: "required",
      city: "invalid",
    });
    expect(invalid.first).toEqual(Option.some("companyName"));
  });

  test("Billing counts its fields to fix; Profile points to Billing", () => {
    const { draft, invalid } = refused({
      companyName: "",
      zip: "1".repeat(21),
    });
    const state = ProfileSubmitState.Invalid({ invalid, attempt: {} });

    expect(
      profileFooterView(
        state,
        true,
        billingFormView(sampleProfile, draft).fields
      ).message
    ).toEqual({ kind: "fix-fields", count: 2 });
    expect(profileFooterView(state, true, identityFields).message).toEqual({
      kind: "fix-elsewhere",
    });
  });

  test("a field the chosen kind doesn't save is never refused", () => {
    const draft = afterChanges(business, {
      billingKind: "personal",
      companyName: "",
    });

    expect(Result.isSuccess(validateProfileDraft(draft, phoneRegion))).toBe(
      true
    );
  });
});
