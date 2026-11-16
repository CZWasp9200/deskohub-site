import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Schema } from "effect";
import {
  type AppliedDiscount,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { promotionCodeIdSchema } from "@/features/discounts/persistence-contracts";
import { m } from "@/features/i18n";
import { getReferralBenefitIds } from "./referral-benefits";
import {
  isAttributedToAnotherReferral,
  referralInvitationBenefitChanged,
} from "./referral-invitation-claim-benefits";

const czk = (value: number) => ({ value, exponent: 2, currency: "CZK" });
const invited = "100000001" as DotyposCustomerId;
const referrer = "100000002" as DotyposCustomerId;
const promotionCodeId = promotionCodeIdSchema.make("promotion-1");

const applied = (
  discount: Partial<AppliedDiscount["discount"]>,
  amount = 5250
): AppliedDiscount => ({
  discount: {
    id: Schema.decodeUnknownSync(discountIdSchema)("discount-1"),
    label: "Discount",
    adjustment: { kind: "percentage", basisPoints: 1500 },
    ...discount,
  },
  subtotalBefore: czk(35_000),
  amount: czk(amount),
  subtotalAfter: czk(35_000 - amount),
});

describe("isAttributedToAnotherReferral", () => {
  const claim = {
    kind: "referral_invitation" as const,
    invitedDotyposCustomerId: invited,
    referrerDotyposCustomerId: referrer,
    promotionCodeId,
  };

  test("an unattributed customer or the same referral is not another referral", () => {
    expect(isAttributedToAnotherReferral(undefined, claim)).toBe(false);
    expect(
      isAttributedToAnotherReferral(
        { referrerDotyposCustomerId: referrer, promotionCodeId },
        claim
      )
    ).toBe(false);
  });

  test("another referrer or another code is another referral", () => {
    expect(
      isAttributedToAnotherReferral(
        { referrerDotyposCustomerId: "100000003", promotionCodeId },
        claim
      )
    ).toBe(true);
    expect(
      isAttributedToAnotherReferral(
        {
          referrerDotyposCustomerId: referrer,
          promotionCodeId: promotionCodeIdSchema.make("promotion-2"),
        },
        claim
      )
    ).toBe(true);
    expect(
      isAttributedToAnotherReferral(
        { referrerDotyposCustomerId: referrer, promotionCodeId: null },
        claim
      )
    ).toBe(true);
  });
});

describe("referralInvitationBenefitChanged", () => {
  const claim = {
    kind: "referral_invitation" as const,
    invitedDotyposCustomerId: invited,
    referrerDotyposCustomerId: referrer,
    promotionCodeId,
  };
  const invitation = (
    discount: Partial<AppliedDiscount["discount"]> = {},
    amount?: number
  ) =>
    applied(
      {
        id: getReferralBenefitIds(invited).invitation,
        label: m.checkoutSummaryItemReferralInvitationDiscount(
          {},
          { locale: "en-US" }
        ),
        ...discount,
      },
      amount
    );

  test("keeps the invitee's own positive 15% invitation", () => {
    expect(
      referralInvitationBenefitChanged({
        claim,
        application: invitation(),
        locale: "en-US",
      })
    ).toBe(false);
  });

  test.each([
    [
      "a self-referral",
      { ...claim, referrerDotyposCustomerId: invited },
      invitation(),
    ],
    [
      "another customer's invitation",
      claim,
      invitation({ id: getReferralBenefitIds(referrer).invitation }),
    ],
    ["another label", claim, invitation({ label: "Other" })],
    [
      "a fixed adjustment",
      claim,
      invitation({ adjustment: { kind: "fixed", amount: czk(5250) } }),
    ],
    [
      "another percentage",
      claim,
      invitation({ adjustment: { kind: "percentage", basisPoints: 1000 } }),
    ],
    ["a zero amount", claim, invitation({}, 0)],
  ] as const)("changes with %s", (_case, changedClaim, application) => {
    expect(
      referralInvitationBenefitChanged({
        claim: changedClaim,
        application,
        locale: "en-US",
      })
    ).toBe(true);
  });

  test("changes when the label belongs to another locale", () => {
    expect(
      referralInvitationBenefitChanged({
        claim,
        application: invitation(),
        locale: "cs-CZ",
      })
    ).toBe(true);
  });
});
