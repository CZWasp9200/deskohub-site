import { beforeAll, describe, expect, test } from "bun:test";
import type { CustomerCompanyDetails } from "@deskohub/workspace-customer-api";
import { RegistryContext } from "@effect/atom-react";
import { Effect } from "effect";
import {
  act,
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { makeFakeCustomerData } from "../customer-api/testing/customer-data-test-registry";
import { fakeWorkspaceOrigin } from "../customer-api/testing/fake-workspace";
import {
  sampleCompanies,
  sampleUnreachableCompanyId,
} from "../customer-api/testing/sample-fixtures";
import { clientRoot } from "../testing/client-root";
import { eventually } from "../testing/eventually";
import { Button } from "../ui/controls";
import { elementTree, findAll } from "../ui/testing/element-tree";
import { CompanyLookup } from "./company-lookup";
import type { CompanyDetailsField, LookupStatus } from "./company-lookup-model";

const { render } = clientRoot({ keepFetch: true });
// Request URLs resolve against the page's location, which the DOM leaves at
// about:blank: put the page on the fake Workspace, as the web app is served.
beforeAll(() => {
  (
    globalThis as unknown as {
      happyDOM: { setURL: (url: string) => void };
    }
  ).happyDOM.setURL(fakeWorkspaceOrigin);
});

const locale = "en-US";
const fields: ReadonlyArray<{ field: CompanyDetailsField; label: string }> = [
  "companyName",
  "companyId",
  "vatId",
  "addressLine1",
  "city",
  "zip",
  "country",
].map((field) => ({ field: field as CompanyDetailsField, label: field }));

type AnyProps = Readonly<Record<string, unknown>>;

/** The first child element of the lookup whose props name `prop`. */
const childWith = (tree: ReactNode, prop: string) => {
  if (!isValidElement<{ children?: ReactNode }>(tree)) return undefined;
  return Children.toArray(tree.props.children).find(
    (child): child is ReactElement<AnyProps> =>
      isValidElement<AnyProps>(child) && prop in child.props
  );
};

/** Mounts the lookup over a fake Workspace with the field holding `companyId`. */
const mountLookup = async ({
  companyId,
  kind = "linked",
}: {
  readonly companyId: string;
  readonly kind?: "linked" | "deletion-pending";
}) => {
  const data = makeFakeCustomerData(kind);
  const applied: Array<Partial<CustomerCompanyDetails>> = [];
  let tree: ReactNode = null;
  let typed = companyId;
  const Probe = () => {
    tree = CompanyLookup({
      companyId: typed,
      fields,
      onApply: (details) => applied.push(details),
      disabled: false,
      remindsToSave: true,
      locale,
    });
    return null;
  };
  const draw = () =>
    render(
      <RegistryContext.Provider value={data.registry}>
        <Probe />
      </RegistryContext.Provider>
    );
  await draw();
  const lookupButton = () =>
    findAll(tree, Button)[0]?.props as Parameters<typeof Button>[0];
  const status = () =>
    childWith(tree, "status")?.props.status as LookupStatus | undefined;
  const found = () => {
    const review = childWith(tree, "onDismiss");
    if (review === undefined) return undefined;
    const buttons = findAll(
      elementTree(review.type as (props: AnyProps) => ReactNode, review.props),
      Button
    );
    return {
      apply: () => act(async () => buttons[0]?.props.onPress()),
      dismiss: () => act(async () => buttons[1]?.props.onPress()),
      buttons: buttons.length,
    };
  };
  return {
    ...data,
    applied,
    lookupButton,
    status,
    found,
    press: () => act(async () => lookupButton().onPress()),
    type: (value: string) => {
      typed = value;
      return draw();
    },
    settled: () =>
      Effect.runPromise(
        eventually(
          () => lookupButton().busy !== true && status() !== undefined,
          () => JSON.stringify(status())
        )
      ).then(draw),
  };
};

describe("CompanyLookup over the customer API", () => {
  test("found: the review waits; Apply fills exactly the returned fields", async () => {
    const lookup = await mountLookup({ companyId: "12345679" });
    await lookup.press();
    await lookup.settled();
    expect(lookup.status()?.tone).toBe("positive");
    expect(lookup.found()?.buttons).toBe(2);
    expect(lookup.applied).toEqual([]);

    await lookup.found()?.apply();
    expect(lookup.applied).toEqual([
      sampleCompanies.get("12345679") as CustomerCompanyDetails,
    ]);
    expect(lookup.found()).toBeUndefined();
    expect(lookup.status()?.tone).toBe("positive");
  });

  test("a company without a VAT ID applies no VAT ID", async () => {
    const lookup = await mountLookup({ companyId: "00000019" });
    await lookup.press();
    await lookup.settled();
    await lookup.found()?.apply();
    expect(Object.keys(lookup.applied[0] ?? {})).not.toContain("vatId");
  });

  test("Dismiss leaves the draft unchanged", async () => {
    const lookup = await mountLookup({ companyId: "12345679" });
    await lookup.press();
    await lookup.settled();
    await lookup.found()?.dismiss();
    expect(lookup.applied).toEqual([]);
    expect(lookup.found()).toBeUndefined();
    expect(lookup.status()).toBeUndefined();
  });

  test("an empty field calls nothing and says the ID is invalid", async () => {
    const lookup = await mountLookup({ companyId: "  " });
    await lookup.press();
    expect(lookup.workspace.calls).not.toContain("lookupCompany");
    expect(lookup.status()?.tone).toBe("danger");
  });

  test("not found and registry unavailable offer Try again", async () => {
    for (const companyId of ["87654321", sampleUnreachableCompanyId]) {
      const lookup = await mountLookup({ companyId });
      await lookup.press();
      await lookup.settled();
      expect(lookup.status()?.tone).toBe("danger");
      expect(lookup.found()).toBeUndefined();
      expect(lookup.lookupButton().disabled).toBe(false);
    }
  });

  test("an account awaiting deletion gets the field's error", async () => {
    const lookup = await mountLookup({
      companyId: "12345679",
      kind: "deletion-pending",
    });
    await lookup.press();
    await lookup.settled();
    expect(lookup.status()?.tone).toBe("danger");
    expect(lookup.found()).toBeUndefined();
  });

  test("the rate limit is said under the button", async () => {
    const lookup = await mountLookup({ companyId: "12345679" });
    lookup.workspace.fail("lookupCompany", "rate-limited");
    await lookup.press();
    await lookup.settled();
    expect(lookup.status()?.tone).toBe("danger");
  });

  test("looking up shows progress in the button; typing another ID frees it", async () => {
    const lookup = await mountLookup({ companyId: "12345679" });
    lookup.workspace.fail("lookupCompany", "hang");
    await lookup.press();
    expect(lookup.lookupButton().busy).toBe(true);
    await lookup.type("00000019");
    expect(lookup.lookupButton().busy).toBe(false);
    expect(lookup.status()).toBeUndefined();
  });

  test("a found company doesn't come back when its ID is typed again", async () => {
    const lookup = await mountLookup({ companyId: "12345679" });
    await lookup.press();
    await lookup.settled();
    expect(lookup.found()).toBeDefined();
    await lookup.type("00000019");
    await lookup.type("12345679");
    expect(lookup.found()).toBeUndefined();
    expect(lookup.status()).toBeUndefined();
    expect(lookup.applied).toEqual([]);
  });

  test("an edit drops a pending lookup; the next press asks again and answers", async () => {
    const lookup = await mountLookup({ companyId: "12345679" });
    lookup.workspace.fail("lookupCompany", "hang");
    await lookup.press();
    await lookup.type("00000019");
    await lookup.type("12345679");
    expect(lookup.lookupButton().busy).toBe(false);
    expect(lookup.status()).toBeUndefined();

    // The new request interrupts the one that never answered.
    await lookup.press();
    await lookup.settled();
    expect(lookup.status()?.tone).toBe("positive");
    expect(lookup.found()).toBeDefined();
    expect(
      lookup.workspace.calls.filter((call) => call === "lookupCompany")
    ).toHaveLength(2);
  });
});
