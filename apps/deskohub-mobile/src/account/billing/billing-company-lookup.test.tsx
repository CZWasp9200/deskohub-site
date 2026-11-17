import { describe, expect, mock, test } from "bun:test";
import type { CustomerCompanyDetails } from "@deskohub/workspace-customer-api";
import { RegistryContext } from "@effect/atom-react";
import { createRef, type ReactElement, type ReactNode } from "react";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";

mock.module("expo-router", () => expoRouterStandIn({}));

const { makeFakeCustomerData } = await import(
  "../../customer-api/testing/customer-data-test-registry"
);
const { FakeWorkspace } = await import(
  "../../customer-api/testing/fake-workspace"
);
const { sampleCompanies, sampleProfile } = await import(
  "../../customer-api/testing/sample-fixtures"
);
const { CompanyLookup } = await import("../../company-lookup/company-lookup");
const { appliedDetails } = await import(
  "../../company-lookup/company-lookup-model"
);
const { elementTree, find } = await import("../../ui/testing/element-tree");
const { m } = await import("../../i18n/messages");
const { useOnboardingDraft } = await import("../onboarding/onboarding-draft");
const { useProfileForm } = await import("../profile/profile-form");
const { BillingCompanyLookup } = await import("./billing-company-lookup");
const { BillingCompanySection } = await import("./billing-sections");

type Registry = ReturnType<typeof makeFakeCustomerData>["registry"];
type ProfileDraft = ReturnType<typeof useProfileForm>["draft"];
type Draft = {
  readonly draft: ProfileDraft;
  readonly change: (change: Partial<ProfileDraft>) => void;
};

const company = sampleCompanies.get("12345679") as CustomerCompanyDetails;

const within = (registry: Registry) => (node: ReactElement) => (
  <RegistryContext.Provider value={registry}>{node}</RegistryContext.Provider>
);

/** What a draft hook returns now, read in a throwaway render. */
const current = (registry: Registry, useDraft: () => Draft): Draft => {
  let draft: Draft | undefined;
  elementTree(
    () => {
      draft = useDraft();
      return null;
    },
    {},
    within(registry)
  );
  if (draft === undefined) throw new Error("The draft hook didn't run.");
  return draft;
};

/** The company lookup the billing section shows, as the screen wires it. */
const lookupOf = (draft: Draft, remindsToSave: boolean, registry: Registry) => {
  const section = elementTree(BillingCompanySection, {
    draft: draft.draft,
    invalid: undefined,
    onChange: () => undefined,
    inputs: createRef() as never,
    editable: true,
    locale: "en-US",
    onApply: draft.change,
    remindsToSave,
  });
  const seam = find(section, BillingCompanyLookup);
  if (seam === undefined) throw new Error("No company lookup in the section.");
  const lookup = find(
    elementTree(
      BillingCompanyLookup,
      seam.props,
      within(registry)
    ) as ReactNode,
    CompanyLookup
  );
  if (lookup === undefined) throw new Error("The seam renders no lookup.");
  return lookup.props;
};

/** Applies the sample company through the lookup, as Apply to draft does. */
const applyThrough = (lookup: ReturnType<typeof lookupOf>) =>
  lookup.onApply(
    appliedDetails(
      company,
      lookup.fields.map(({ field }) => field)
    )
  );

describe("Account › Billing details: Apply reaches the profile draft", () => {
  test("the found company fills the draft; the rest stays as typed", () => {
    const { registry } = makeFakeCustomerData("linked");
    const useDraft = () =>
      useProfileForm({ profile: sampleProfile, locale: "cs-CZ" });
    current(registry, useDraft).change({
      billingKind: "business",
      companyId: "12345679",
      addressLine2: "Typed by hand",
    });

    const lookup = lookupOf(current(registry, useDraft), true, registry);
    expect(lookup.remindsToSave).toBe(true);
    expect(lookup.companyId).toBe("12345679");
    // The review names the country as the form's country picker does.
    expect(lookup.fields.find(({ field }) => field === "country")?.label).toBe(
      m.booking_details_country({}, { locale: "en-US" })
    );
    applyThrough(lookup);

    const { draft } = current(registry, useDraft);
    expect(draft).toMatchObject(company);
    expect(draft.addressLine2).toBe("Typed by hand");
    expect(draft.firstName).toBe(sampleProfile.firstName);
  });
});

describe("Onboarding › Billing details: Apply reaches the completion draft", () => {
  test("the found company fills the draft; no Save reminder", () => {
    const workspace = FakeWorkspace.forKind("completion-required");
    const account = workspace.data.account;
    if (account.kind !== "completion-required") {
      throw new Error("The sample account needs a completion.");
    }
    const { registry } = makeFakeCustomerData("completion-required", workspace);
    const useDraft = () => useOnboardingDraft(account);
    current(registry, useDraft).change({
      billingKind: "business",
      companyId: "12345679",
      vatId: "typed",
    });

    const lookup = lookupOf(current(registry, useDraft), false, registry);
    expect(lookup.remindsToSave).toBe(false);
    applyThrough(lookup);

    const { draft } = current(registry, useDraft);
    expect(draft).toMatchObject(company);
    expect(draft.billingKind).toBe("business");
  });
});
