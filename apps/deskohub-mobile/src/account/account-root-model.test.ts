import { describe, expect, test } from "bun:test";
import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import {
  type SampleAccountKind,
  sampleWorkspaceData,
} from "../customer-api/testing/sample-fixtures";
import { accountIndexModel } from "./account-gating";
import { type AccountRootModel, accountRootModel } from "./account-root-model";

const accountOf = (kind: SampleAccountKind): CustomerAccountState =>
  sampleWorkspaceData(kind).account;

type Linked = Extract<CustomerAccountState, { kind: "linked" }>;
const linked = (): Linked => {
  const account = accountOf("linked");
  if (account.kind !== "linked") throw new Error("fixture is linked");
  return account;
};

const layout = (model: AccountRootModel) =>
  model.groups.map((group) => [
    group.heading ?? "first",
    group.rows.map((row) => row.section),
  ]);

const subtitleOf = (model: AccountRootModel, section: string) =>
  model.groups
    .flatMap((group) => group.rows)
    .find((row) => row.section === section)?.subtitle;

describe("accountRootModel", () => {
  test("a linked account: its sections on the masthead, then Rewards, Privacy and the Danger zone", () => {
    const model = accountRootModel(linked());

    expect(model.completionCard).toBe(false);
    expect(layout(model)).toEqual([
      [
        "first",
        [
          "profile",
          "security",
          "assistants",
          "billing",
          "invoices",
          "language",
        ],
      ],
      ["rewards", ["referrals"]],
      ["privacy", ["legal"]],
      ["danger", ["danger"]],
    ]);
  });

  test("payment methods sits between billing and invoices only while released", () => {
    const firstRows = (paymentMethods: boolean) =>
      layout(accountRootModel(linked(), { paymentMethods }))[0]?.[1];

    expect(firstRows(true)).toEqual([
      "profile",
      "security",
      "assistants",
      "billing",
      "payment-methods",
      "invoices",
      "language",
    ]);
    expect(firstRows(false)).toEqual(
      layout(accountRootModel(linked()))[0]?.[1]
    );
    expect(firstRows(false)).not.toContain("payment-methods");
    // Neither row says anything about its section yet.
    const model = accountRootModel(linked(), { paymentMethods: true });
    expect(subtitleOf(model, "payment-methods")).toBeUndefined();
    expect(subtitleOf(model, "invoices")).toBeUndefined();
  });

  test("before the profile exists: the card, then the reachable sections under Your account", () => {
    const model = accountRootModel(accountOf("completion-required"));

    expect(model.completionCard).toBe(true);
    expect(layout(model)).toEqual([
      ["your-account", ["security", "assistants", "language", "legal"]],
      ["danger", ["danger"]],
    ]);
    // Marketing emails need a profile, so the row doesn't name them.
    expect(subtitleOf(model, "legal")).toBeUndefined();
  });

  test.each([
    "support-required",
    "authenticated-unavailable",
    "review-account",
    "deletion-pending",
  ] as const)("a %s account shows exactly the gated sections", (kind) => {
    const account = accountOf(kind);
    const model = accountRootModel(account);

    expect(model.completionCard).toBe(false);
    expect<ReadonlyArray<string>>(
      model.groups.flatMap((group) => group.rows.map((row) => row.section))
    ).toEqual(accountIndexModel(account).sections);
  });

  test("rows say the section's current state", () => {
    const account = linked();
    const model = accountRootModel(account);

    expect(subtitleOf(model, "security")).toEqual({
      kind: "security",
      passkeys: account.passkeys?.passkeys?.length ?? -1,
    });
    expect(subtitleOf(model, "assistants")).toEqual({
      kind: "assistants",
      connected: account.assistants?.length ?? -1,
    });
    expect(subtitleOf(model, "language")).toEqual({ kind: "language" });
    expect(subtitleOf(model, "legal")).toEqual({ kind: "legal" });
    expect(subtitleOf(model, "profile")).toBeUndefined();
    expect(subtitleOf(model, "danger")).toBeUndefined();
  });

  test("unread sign-in methods and assistants claim nothing", () => {
    const account = linked();
    const model = accountRootModel({
      ...account,
      passkeys:
        account.passkeys === undefined
          ? undefined
          : { ...account.passkeys, passkeys: null },
      assistants: null,
    });

    expect(subtitleOf(model, "security")).toBeUndefined();
    expect(subtitleOf(model, "assistants")).toBeUndefined();
  });

  test("billing names the invoicing the saved profile asks for", () => {
    const account = linked();
    const withBilling = (billing: Linked["profile"]["billing"]) =>
      subtitleOf(
        accountRootModel({
          ...account,
          profile: { ...account.profile, billing },
        }),
        "billing"
      );
    const personal = { kind: "personal" as const } as NonNullable<
      Linked["profile"]["billing"]
    >;
    const business = { kind: "business" as const } as NonNullable<
      Linked["profile"]["billing"]
    >;

    expect(withBilling(null)).toEqual({ kind: "billing", invoicing: "none" });
    expect(withBilling(personal)).toEqual({
      kind: "billing",
      invoicing: "personal",
    });
    expect(withBilling(business)).toEqual({
      kind: "billing",
      invoicing: "business",
    });
  });

  describe("invite friends", () => {
    const withReferrals = (
      eligibleInviteeCount: number,
      discountPerInvitee: string | undefined
    ) => {
      const account = linked();
      const overview = account.referrals;
      if (overview === undefined) throw new Error("fixture has referrals");
      return subtitleOf(
        accountRootModel({
          ...account,
          referrals: {
            summary: { ...overview.summary, eligibleInviteeCount },
            shareUrl: overview.shareUrl,
            ...(discountPerInvitee !== undefined && { discountPerInvitee }),
          },
        }),
        "referrals"
      );
    };

    test("with nobody counting yet, offers the programme's rate per invite", () => {
      expect(withReferrals(0, "7.5")).toEqual({
        kind: "referral-offer",
        discountPerInvitee: "7.5",
      });
    });

    test("once friends count, shows the discount they earn", () => {
      const discount = linked().referrals?.summary.discount;
      if (discount === undefined) throw new Error("fixture has referrals");
      expect(withReferrals(2, "5")).toEqual({
        kind: "referral-earned",
        discount,
      });
    });

    test("never invents a rate the Workspace didn't send", () => {
      expect(withReferrals(0, undefined)).toBeUndefined();
    });

    test("hidden while the programme isn't released", () => {
      const model = accountRootModel({ ...linked(), referralsEnabled: false });
      expect(model.groups.map((group) => group.heading)).not.toContain(
        "rewards"
      );
    });
  });

  test("the masthead shows the profile's name, initials and photo", () => {
    const account = linked();
    const { identity } = accountRootModel({
      ...account,
      profile: {
        ...account.profile,
        firstName: " Jana ",
        lastName: "Nováková",
      },
      avatar: {
        kind: "available",
        avatar: { url: "https://images.example/avatar.webp" },
      },
    });

    expect(identity).toEqual({
      email: account.email,
      name: "Jana Nováková",
      initials: "JN",
      photoUrl: "https://images.example/avatar.webp",
    });
  });

  test("an account without a profile shows only its email", () => {
    const account = accountOf("completion-required");
    expect(accountRootModel(account).identity).toEqual({
      email: account.email,
    });
  });
});
