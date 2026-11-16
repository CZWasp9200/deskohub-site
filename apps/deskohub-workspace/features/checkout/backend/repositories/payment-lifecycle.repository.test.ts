import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  getDiscountCommitmentPayload,
  makeDiscountCommitment,
} from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import type { DiscountClaimInstruction } from "@/features/discounts/provider";
import {
  validateDiscountCommitment,
  validateInternalPaymentCommitment,
} from "./payment-lifecycle.repository";

const product = { kind: "cowork", tier: "basic" } as const;
const czk = (value: number) => ({ value, exponent: 2, currency: "CZK" });

/** A consistent 10% application of `claim` to `subtotal`. */
const claimedApplication = (
  subtotal: number,
  claim: DiscountClaimInstruction | undefined,
  id: string
) => {
  const discount = {
    id: Schema.decodeUnknownSync(discountIdSchema)(id),
    label: "Test discount",
    adjustment: { kind: "percentage" as const, basisPoints: 1000 },
  };
  return {
    application: {
      discount,
      subtotalBefore: czk(subtotal),
      amount: czk(subtotal / 10),
      subtotalAfter: czk(subtotal - subtotal / 10),
    },
    candidate: {
      discount,
      provenance: { providerNamespace: "test", providerReference: id },
      ...(claim && { claim }),
    },
  };
};

const codeClaim = (codeId: string, tier: "basic" | "pro" = "basic") =>
  ({
    kind: "discount_code",
    codeId,
    storedDiscountId: `stored-${codeId}`,
    dotyposCustomerId: "customer-1",
    product: { kind: "cowork", tier },
  }) as DiscountClaimInstruction;

const voucherClaim = (voucherId: string) =>
  ({
    kind: "voucher",
    voucherId,
    availableAmount: czk(1000),
    dotyposCustomerId: "customer-1",
  }) as DiscountClaimInstruction;

const invitationClaim = () =>
  ({
    kind: "referral_invitation",
    invitedDotyposCustomerId: "customer-1",
    referrerDotyposCustomerId: "customer-2",
    promotionCodeId: "promotion-1",
  }) as DiscountClaimInstruction;

const validateClaims = (
  claims: readonly (DiscountClaimInstruction | undefined)[],
  committedProduct: {
    readonly kind: "cowork";
    readonly tier: "basic" | "pro";
  } = product
) =>
  Effect.runPromise(
    Effect.result(
      validateDiscountCommitment(
        getDiscountCommitmentPayload(
          makeDiscountCommitment({
            product: committedProduct,
            firstServiceDate: "2099-01-01",
            applications: claims.map((claim, index) =>
              claimedApplication(
                10_000 * 0.9 ** index,
                claim,
                `discount-${index}`
              )
            ),
          })
        )
      )
    )
  );

describe("PaymentLifecycleRepository", () => {
  test("rejects inconsistent committed money before opening a transaction", async () => {
    const discountId =
      Schema.decodeUnknownSync(discountIdSchema)("public-discount");
    const application = {
      discount: {
        id: discountId,
        label: "Test discount",
        adjustment: { kind: "percentage" as const, basisPoints: 2000 },
      },
      subtotalBefore: {
        value: 35_000,
        exponent: 2,
        currency: "CZK",
      },
      amount: { value: 7000, exponent: 2, currency: "CZK" },
      subtotalAfter: {
        value: 27_999,
        exponent: 2,
        currency: "CZK",
      },
    };
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      firstServiceDate: "2099-01-01",
      applications: [
        {
          application,
          candidate: {
            discount: application.discount,
            provenance: {
              providerNamespace: "test",
              providerReference: "test",
            },
          },
        },
      ],
    });

    const result = await Effect.runPromise(
      Effect.result(
        validateDiscountCommitment(getDiscountCommitmentPayload(commitment))
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "money_mismatch",
      },
    });
  });

  test("rejects an internal payment without a full-discount commitment", async () => {
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      firstServiceDate: "2099-01-01",
      applications: [],
    });

    const result = await Effect.runPromise(
      Effect.result(
        validateInternalPaymentCommitment(
          getDiscountCommitmentPayload(commitment),
          {
            value: 0,
            exponent: 2,
            currency: "CZK",
          }
        )
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "money_mismatch",
      },
    });
  });

  test("keeps one ordinary and one invitation claim with their positions", async () => {
    const result = await validateClaims([
      undefined,
      codeClaim("code-1"),
      invitationClaim(),
    ]);

    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") throw new Error("Expected success");
    expect(result.success.code).toMatchObject({
      index: 1,
      claim: { codeId: "code-1" },
    });
    expect(result.success.referral).toMatchObject({
      index: 2,
      claim: { kind: "referral_invitation" },
    });
  });

  test("keeps no claim for unclaimed applications", async () => {
    const result = await validateClaims([undefined, undefined]);

    expect(result._tag).toBe("Success");
    expect(result).toMatchObject({
      success: { code: undefined, referral: undefined },
    });
  });

  test("refuses a second ordinary claim with the second claim's code", async () => {
    expect(
      await validateClaims([codeClaim("code-1"), voucherClaim("voucher-1")])
    ).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "claim_conflict",
        codeId: "voucher-1",
      },
    });
  });

  test("refuses a second invitation claim", async () => {
    expect(
      await validateClaims([invitationClaim(), invitationClaim()])
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "claim_conflict", codeId: undefined },
    });
  });

  test("refuses a discount-code claim for another product", async () => {
    expect(
      await validateClaims([invitationClaim(), codeClaim("code-1", "pro")])
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "product_ineligible", codeId: "code-1" },
    });
  });

  test("checks an application's money before its claim", async () => {
    const commitment = makeDiscountCommitment({
      product,
      firstServiceDate: "2099-01-01",
      applications: [
        claimedApplication(10_000, codeClaim("code-1"), "discount-0"),
        (() => {
          const next = claimedApplication(
            9000,
            voucherClaim("voucher-1"),
            "discount-1"
          );
          return {
            ...next,
            application: { ...next.application, subtotalAfter: czk(1) },
          };
        })(),
      ],
    });

    expect(
      await Effect.runPromise(
        Effect.result(
          validateDiscountCommitment(getDiscountCommitmentPayload(commitment))
        )
      )
    ).toMatchObject({
      _tag: "Failure",
      failure: { reason: "money_mismatch", codeId: "voucher-1" },
    });
  });
});
