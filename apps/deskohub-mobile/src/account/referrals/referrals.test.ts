import { describe, expect, test } from "bun:test";
import {
  type ReferralAccountOverview,
  ReferralCode,
} from "@deskohub/workspace-customer-api";
import { Effect } from "effect";
import { type AsyncResult, type Atom, AtomRegistry } from "effect/reactivity";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import { m } from "../../i18n/messages";
import {
  copyReferralCodeAtom,
  joinedSentence,
  referralsAtom,
  referralsFailure,
  referralsView,
  shareReferralLinkAtom,
} from "./referrals";

const run = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) =>
  Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
    )
  );

// Normalizes Intl's no-break spaces so expectations read plainly.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("referralsAtom", () => {
  test("reads a linked account's summary and share link", async () => {
    const data = makeFakeCustomerData("linked");

    const result = await settle(data.registry, referralsAtom);

    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        summary: { code: "SAMPLE-ALEX", inviteeCount: 3 },
        shareUrl: data.workspace.data.referrals.shareUrl,
      },
    });
    expect(data.workspace.calls).toEqual(["getReferrals"]);
  });

  test("answers feature-unavailable while referrals aren't released", async () => {
    const data = makeFakeCustomerData("linked");
    const { account } = data.workspace.data;
    if (account.kind !== "linked") throw new Error("expected a linked account");
    data.workspace.setAccount({ ...account, referralsEnabled: false });

    const result = await settle(data.registry, referralsAtom);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerFeatureUnavailable", feature: "referrals" },
    });
  });

  test("answers link-required for an account without a usable profile", async () => {
    const data = makeFakeCustomerData("support-required");

    const result = await settle(data.registry, referralsAtom);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerAccountLinkRequired",
        reason: "support-required",
      },
    });
  });

  test("fails when the summary can't be read", async () => {
    const data = makeFakeCustomerData("linked");
    data.workspace.fail("getReferrals", "service-unavailable");

    const result = await settle(data.registry, referralsAtom);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerServiceUnavailable" },
    });
  });
});

describe("referral actions", () => {
  test("copies the code as non-sensitive text", async () => {
    const data = makeFakeCustomerData("linked");
    data.registry.mount(copyReferralCodeAtom);

    data.registry.set(copyReferralCodeAtom, "SAMPLE-ALEX");
    const result = await run(data.registry, copyReferralCodeAtom);

    expect(result._tag).toBe("Success");
    expect(data.device.copied).toEqual([
      { text: "SAMPLE-ALEX", sensitive: false },
    ]);
  });

  test("shares the link with the invitation", async () => {
    const data = makeFakeCustomerData("linked");
    data.registry.mount(shareReferralLinkAtom);
    const link = {
      url: "https://workspace.deskohub.example/r/SAMPLE-ALEX",
      message: "Invitation",
    };

    data.registry.set(shareReferralLinkAtom, link);
    const result = await run(data.registry, shareReferralLinkAtom);

    expect(result._tag).toBe("Success");
    expect(data.device.sharedLinks).toEqual([link]);
  });
});

describe("referralsView", () => {
  const overview: ReferralAccountOverview = {
    summary: {
      code: ReferralCode.make("SAMPLE-ALEX"),
      inviteeCount: 3,
      eligibleInviteeCount: 2,
      discount: "9.75",
      savings: [
        { value: 15000, exponent: 2, currency: "CZK" },
        { value: 1250, exponent: 2, currency: "EUR" },
      ],
    },
    shareUrl: "https://workspace.deskohub.example/r/SAMPLE-ALEX",
    discountPerInvitee: "7.5",
    invitationDiscount: "12.5",
  };

  test("takes every number and rate from the overview", () => {
    const view = referralsView(overview, "en-US");

    expect({ ...view, savings: view.savings.map(plain) }).toEqual({
      code: "SAMPLE-ALEX",
      shareUrl: overview.shareUrl,
      joined: { kind: "some", invitees: 3, eligibleInvitees: 2 },
      discount: "9.75%",
      savings: ["CZK 150", "€12.50"],
      invitationDiscount: "12.5%",
      discountPerInvitee: "7.5%",
      example: { perInvitee: "7.5%", referrals: 2, total: "9.75%" },
    });
  });

  test("before anyone counts, the example shows one friend's worth", () => {
    const view = referralsView(
      {
        ...overview,
        summary: {
          ...overview.summary,
          inviteeCount: 0,
          eligibleInviteeCount: 0,
          discount: "0",
          savings: [],
        },
      },
      "cs-CZ"
    );

    expect(view.joined).toEqual({ kind: "nobody" });
    expect(view.savings).toEqual([]);
    expect(view.example?.referrals).toBe(1);
    expect(view.example?.perInvitee).toBe(view.discountPerInvitee as string);
    expect(view.example?.total).toBe(view.discountPerInvitee as string);
  });

  test("with nothing saved, a zero in the server's currency", () => {
    const view = referralsView(
      {
        ...overview,
        summary: { ...overview.summary, savings: [] },
        savingsCurrency: "CZK",
      },
      "en-US"
    );

    expect(view.savings.map(plain)).toEqual(["CZK 0"]);
  });

  test("someone joined but nobody counts yet", () => {
    const view = referralsView(
      {
        ...overview,
        summary: {
          ...overview.summary,
          eligibleInviteeCount: 0,
          discount: "0",
        },
      },
      "en-US"
    );

    expect(view.joined).toEqual({
      kind: "some",
      invitees: 3,
      eligibleInvitees: 0,
    });
  });

  test("an overview without the programme rates leaves them out", () => {
    const { discountPerInvitee, invitationDiscount, ...older } = overview;
    const view = referralsView(older, "en-US");

    expect(view.discountPerInvitee).toBeUndefined();
    expect(view.invitationDiscount).toBeUndefined();
    expect(view.example).toBeUndefined();
  });
});

describe("referral savings", () => {
  test.each([
    [15000, "CZK", "en-US", "CZK 150"],
    [15000, "CZK", "cs-CZ", "150 Kč"],
    [15050, "CZK", "cs-CZ", "150,50 Kč"],
    [1250, "EUR", "cs-CZ", "12,50 €"],
  ] as const)(
    "formats %d minor %s in %s as %s",
    (value, currency, locale, expected) => {
      const view = referralsView(
        {
          summary: {
            code: ReferralCode.make("SAMPLE-ALEX"),
            inviteeCount: 1,
            eligibleInviteeCount: 1,
            discount: "5",
            savings: [{ value, exponent: 2, currency }],
          },
          shareUrl: "https://workspace.deskohub.example/r/SAMPLE-ALEX",
        },
        locale
      );

      expect(view.savings.map(plain)).toEqual([expected]);
    }
  );
});

describe("referralsFailure", () => {
  test("words each failure the screen explains itself", () => {
    expect(
      referralsFailure(
        CustomerViewError.FeatureUnavailable({ feature: "referrals" })
      )
    ).toBe("not-released");
    expect(referralsFailure(CustomerViewError.Unavailable())).toBe(
      "summary-unavailable"
    );
    expect(referralsFailure(CustomerViewError.TimedOut())).toBe(
      "summary-unavailable"
    );
    expect(referralsFailure(CustomerViewError.RateLimited())).toBeUndefined();
    expect(
      referralsFailure(
        CustomerViewError.LinkRequired({ reason: "support-required" })
      )
    ).toBeUndefined();
  });
});

describe("joinedSentence", () => {
  test("says nobody joined", () => {
    expect(joinedSentence({ kind: "nobody" }, "en-US")).toBe(
      m.referrals_joined_nobody({}, { locale: "en-US" })
    );
  });

  test("puts who joined and who counts into one sentence", () => {
    const locale = "en-US";
    expect(
      joinedSentence({ kind: "some", invitees: 3, eligibleInvitees: 2 }, locale)
    ).toBe(
      m.referrals_joined_some(
        {
          invitees: m.referrals_joined_invitees({ count: 3 }, { locale }),
          eligible: m.referrals_joined_eligible({ count: 2 }, { locale }),
        },
        { locale }
      )
    );
  });

  test("says when nobody counts yet rather than counting zero", () => {
    const locale = "cs-CZ";
    expect(
      joinedSentence({ kind: "some", invitees: 2, eligibleInvitees: 0 }, locale)
    ).toBe(
      m.referrals_joined_some(
        {
          invitees: m.referrals_joined_invitees({ count: 2 }, { locale }),
          eligible: m.referrals_joined_eligible_none({}, { locale }),
        },
        { locale }
      )
    );
  });

  // One, few and many as Czech counts them; English has one and other.
  test.each([
    ["cs-CZ", [1, 3, 5]],
    ["en-US", [1, 3]],
  ] as const)("reads each %s plural form differently", (locale, counts) => {
    const forms = (
      message: typeof m.referrals_joined_invitees
    ): ReadonlySet<string> =>
      new Set(
        counts.map((count) =>
          message({ count }, { locale }).replace(String(count), "#")
        )
      );
    expect(forms(m.referrals_joined_invitees).size).toBe(counts.length);
    // Czech "se počítá" serves one and many alike; only few differs.
    expect(forms(m.referrals_joined_eligible).size).toBeGreaterThan(1);
  });
});
