import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { CustomerCompanyDetails } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import {
  Children,
  isValidElement,
  type JSXElementConstructor,
  type ReactElement,
  type ReactNode,
} from "react";
import { expoRouterStandIn } from "../../testing/expo-router-stand-in";
import type { HostProps } from "../../ui/testing/element-tree";
import type { DetailsDraft } from "./details-form";
import type { DetailsStepProps } from "./details-step";

// The bar registers its height with the toasts while its screen has focus;
// outside a navigator the focus effect does nothing.
mock.module("expo-router", () =>
  expoRouterStandIn({ useFocusEffect: () => undefined })
);

const { m } = await import("../../i18n/messages");
const { elementTree, find, findAll, flatStyle, hostTree } = await import(
  "../../ui/testing/element-tree"
);
const { BookingBar } = await import("../ui/booking-bar");
const { priceBreakdown } = await import("../ui/price-breakdown");
const { describePriceLine } = await import("../ui/price-line-description");
const { openSpaceWithCoffee } = await import("../ui/testing/price-fixtures");
const { initialDetailsDraft } = await import("./details-form");
const { DetailsStep } = await import("./details-step");
const { CompanyLookup } = await import("../../company-lookup/company-lookup");
const { appliedDetails } = await import(
  "../../company-lookup/company-lookup-model"
);
const { sampleCompanies } = await import(
  "../../customer-api/testing/sample-fixtures"
);

const locale = "en-US" as const;
const ignore = () => undefined;

const props = (
  overrides: Partial<DetailsStepProps> = {}
): DetailsStepProps => ({
  profile: {
    self: {
      email: testEmailAddress("booker"),
      name: Option.some("Synthetic Booker"),
      phone: Option.some("+420 700 000 000"),
    },
    saved: { address: Option.none(), company: Option.none() },
  },
  initials: Option.some("SB"),
  onEditProfile: Option.some(ignore),
  draft: initialDetailsDraft(
    { address: Option.none(), company: Option.none() },
    "CZ"
  ),
  onDraftChange: ignore,
  notice: Option.none(),
  busy: false,
  summary: {
    title: "Thu 26 Nov",
    detail: "Open Space",
    price: {
      kind: "quoted",
      breakdown: priceBreakdown(openSpaceWithCoffee.summary),
      describeLine: describePriceLine(openSpaceWithCoffee.selection, locale),
    },
  },
  consentLocale: locale,
  onOpenMarketingDocument: ignore,
  onContinue: ignore,
  onRetry: ignore,
  locale,
  ...overrides,
});

const screenOf = (overrides: Partial<DetailsStepProps> = {}) => {
  const tree = elementTree(DetailsStep, props(overrides));
  if (!isValidElement<HostProps>(tree)) throw new Error("no screen");
  return tree;
};

const scrollOf = (screen: ReactElement<HostProps>) => {
  const scroll = find(screen, "ScrollView");
  if (scroll === undefined) throw new Error("no scroll view");
  return scroll;
};

/** The names of the text inputs a node renders, down to its host elements. */
const inputNames = (node: ReactNode) =>
  findAll(hostTree(node), "TextInput").map(
    (input) => input.props["aria-label"]
  );

const business = (patch: Partial<DetailsDraft> = {}): DetailsDraft => ({
  ...props().draft,
  billing: "business",
  ...patch,
});

describe("DetailsStep layout (the company form scrolls, board 30)", () => {
  test("the whole company form is inside one scroll view that grows with it", () => {
    const screen = screenOf({ draft: business() });
    const scroll = scrollOf(screen);
    expect(flatStyle(scroll.props.style).flex).toBe(1);
    const content = flatStyle(scroll.props.contentContainerStyle);
    expect(content.flex).toBeUndefined();
    expect(content.height).toBeUndefined();
    const names = inputNames(scroll);
    for (const label of [
      m.booking_details_company_name({}, { locale }),
      m.booking_details_company_id({}, { locale }),
      m.booking_details_street({}, { locale }),
      m.booking_details_postal_code({}, { locale }),
    ]) {
      expect(names).toContain(label);
    }
  });

  test("Continue sits in the sticky bar below the scroll view, never inside it", () => {
    const screen = screenOf({ draft: business() });
    const scroll = scrollOf(screen);
    expect(findAll(scroll, BookingBar)).toHaveLength(0);
    const children = (screen.props.children as ReadonlyArray<ReactNode>).filter(
      isValidElement
    );
    const scrollAt = children.findIndex((child) => child.type === "ScrollView");
    const barAt = children.findIndex((child) => child.type === BookingBar);
    expect(scrollAt).toBeGreaterThanOrEqual(0);
    expect(barAt).toBeGreaterThan(scrollAt);
  });

  test("the keyboard lifts the screen by the header above it too, so Continue stays visible", () => {
    const screen = screenOf({ keyboardOffset: 56 });
    expect(screen.type).toBe("KeyboardAvoidingView");
    expect(screen.props.keyboardVerticalOffset).toBe(56);
  });
});

describe("DetailsStep fields", () => {
  test("booking for someone else asks for one email, with no repeat", () => {
    const screen = screenOf({
      draft: { ...props().draft, bookingFor: "someone-else" },
    });
    const emails = findAll(hostTree(scrollOf(screen)), "TextInput").filter(
      (input) => input.props.keyboardType === "email-address"
    );
    expect(emails).toHaveLength(1);
  });

  test("a saved address is offered without asking for one", () => {
    const saved = {
      address: Option.some({
        line1: "Křižíkova 12",
        city: "Praha",
        postalCode: "186 00",
        country: "CZ",
      }),
      company: Option.none(),
    };
    const screen = screenOf({
      profile: { ...props().profile, saved },
      draft: { ...props().draft, billing: "personal-invoice" },
    });
    expect(inputNames(scrollOf(screen))).not.toContain(
      m.booking_details_street({}, { locale })
    );
  });

  test("the country is picked from a list, not typed", () => {
    const names = inputNames(scrollOf(screenOf({ draft: business() })));
    expect(names).not.toContain(m.booking_details_country({}, { locale }));
  });

  test("the news consent is offered only when booking for oneself", () => {
    const consent = m.booking_details_marketing_consent({}, { locale });
    const has = (draft: DetailsDraft) =>
      JSON.stringify(hostTree(scrollOf(screenOf({ draft })))).includes(consent);
    expect(has(props().draft)).toBe(true);
    expect(has({ ...props().draft, bookingFor: "someone-else" })).toBe(false);
  });
});

describe("DetailsStep errors (board 31)", () => {
  const barOf = (screen: ReactElement<HostProps>) => {
    const bar = find(screen, BookingBar);
    if (bar === undefined) throw new Error("no bar");
    return bar.props as Parameters<typeof BookingBar>[0];
  };

  test("problems are counted by Continue in the error tone; Continue stays enabled", () => {
    const bar = barOf(
      screenOf({
        draft: { ...props().draft, billing: "personal-invoice" },
        initialProblems: {
          "address.line1": "required",
          "address.city": "required",
        },
      })
    );
    expect(bar.reasonTone).toBe("error");
    expect(bar.reason).toBe(
      m.booking_details_fix_fields({ count: 2 }, { locale })
    );
    expect(bar.action.disabled).toBeUndefined();
  });

  test("while the hold is made, the button is busy and the note is plain", () => {
    const bar = barOf(screenOf({ busy: true }));
    expect(bar.action.busy).toBe(true);
    expect(bar.reasonTone).toBe("plain");
  });
});

describe("DetailsStep booking as", () => {
  test("the full email sits on one line, shrinking to fit rather than wrapping", () => {
    const email = props().profile.self.email;
    const texts = findAll(hostTree(scrollOf(screenOf())), "Text").filter(
      (text) => text.props.children === email
    );
    expect(texts).toHaveLength(1);
    expect(texts[0]?.props.numberOfLines).toBe(1);
    expect(texts[0]?.props.adjustsFontSizeToFit).toBe(true);
  });
});

/** The first element of `type`, running the components above it to reach it. */
const findRendered = <Props,>(
  node: ReactNode,
  type: JSXElementConstructor<Props>
): ReactElement<Props> | undefined => {
  if (!isValidElement<HostProps>(node)) return undefined;
  if (node.type === type) return node as unknown as ReactElement<Props>;
  if (typeof node.type === "function") {
    return findRendered(
      elementTree(node.type as (props: HostProps) => ReactNode, node.props),
      type
    );
  }
  for (const child of Children.toArray(node.props.children)) {
    const found = findRendered(child, type);
    if (found !== undefined) return found;
  }
  return undefined;
};

describe("DetailsStep company lookup (board 30b)", () => {
  const typed = (companyId: string) =>
    business({
      company: {
        ...business().company,
        companyId,
        vatId: "typed VAT ID",
        address: { ...business().company.address, line1: "Typed street 1" },
      },
    });

  const applyFound = (companyId: string) => {
    const changes: Array<DetailsDraft> = [];
    const lookup = findRendered(
      screenOf({
        draft: typed(companyId),
        onDraftChange: (draft) => changes.push(draft),
      }),
      CompanyLookup
    );
    if (lookup === undefined) throw new Error("no company lookup");
    const company = sampleCompanies.get(companyId) as CustomerCompanyDetails;
    lookup.props.onApply(
      appliedDetails(
        company,
        lookup.props.fields.map(({ field }) => field)
      )
    );
    return { lookup: lookup.props, changes, company };
  };

  test("Apply reaches the details draft as typing would", () => {
    const { lookup, changes, company } = applyFound("12345679");
    expect(lookup.companyId).toBe("12345679");
    // Checkout has no Save button to remind of.
    expect(lookup.remindsToSave).toBe(false);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.billing).toBe("business");
    expect<unknown>(changes[0]?.company).toEqual({
      legalName: company.companyName,
      companyId: company.companyId,
      vatId: company.vatId,
      address: {
        line1: company.addressLine1,
        city: company.city,
        postalCode: company.zip,
        country: company.country,
      },
    });
  });

  test("a detail the registry lacks keeps what was typed", () => {
    const { changes } = applyFound("00000019");
    expect(changes[0]?.company.vatId).toBe("typed VAT ID");
  });

  test("the review lists only the fields the company form has", () => {
    const { lookup } = applyFound("12345679");
    expect(lookup.fields.map(({ field }) => field)).not.toContain(
      "addressLine2"
    );
  });
});
