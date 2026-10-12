---
name: deskohub-workspace-referrals
description: Workspace referral attribution, referral-code lookup, invitation and referrer discounts, first-booking claims, referral payment lifecycle, graph locks, and PostgreSQL referral tests.
---

# Deskohub Workspace referrals

Read the business-facing [referral specification](../../../apps/deskohub-workspace/docs/referrals.md) before changing referral eligibility, attribution, discount, or payment behavior. Treat it as the policy source; keep implementation guidance here.

## Public boundaries

- `features/referrals/client.ts` is browser-safe. Use `parseReferralCode` for untrusted values and `referralCodeQueryParam` for the `ref` search parameter carried by share links, sign-in, and reservation pages.
- `features/referrals/index.ts` exports `ReferralService`; `ReferralError` and the public referral types live in `features/referrals/contracts.ts`. Use `ReferralService.Live` for production composition. `lookupCodeKind` is a pure registry lookup; it may distinguish referral from ordinary codes but must not issue a code or change attribution.
- `getAccountSummary` is an explicit account read that may create the customer's durable share code. Do not call it from quote or checkout pricing.
- `findAvailableCode` is a read-only check that returns the canonical code only when it is an enabled, currently valid referral code whose owner has a linked account without pending deletion. Use it to validate or prefill a code before any write; it never issues codes or attributions.
- `acceptReferral` is the only attribution mutation. It validates the linked Dotypos identity and active referrer, then writes the permanent relationship. It is idempotent for the same referrer and rejects a changed referrer, self-referral, ineligible first-booking history, or a cycle. It takes the account advisory lock in its own transaction, so never call it while another account lock or transaction is held.
- Only three callers may attribute, matching the business sources:
  - First-time profile completion (`features/account/actions.ts`, create branch only): the code is checked with `findAvailableCode` before the profile is created, and an unusable code returns `referral-code-unavailable`. Acceptance runs best-effort after creation. An already-linked account ignores the code. The account page prefills the field from `ref` only in the completion-required state, and only when `findAvailableCode` returns it.
  - The checkout code field, through `CheckoutReferralService`.
  - Reservation-page `ref` (`use-reservation-checkout.ts` → `preparePayState` `referralCode`). For `customer: "account"` only, it is accepted silently before `guardStateCreation`, and a successful acceptance adds the `referralApplied` marker.
- Do not add an account-screen or other later acceptance path.
- `features/checkout/backend/checkout/checkout-referral.service.ts` exports `CheckoutReferralService`. Its `acceptCode({ code, payStateToken, locale })` validates the signed checkout identity, deliberately accepts the relationship, and returns one of these statuses:
  - `accepted` or `already_accepted`, with an updated signed checkout URL.
  - `already_attributed` (a different existing referrer) or `ineligible` (not the first booking). The discount action redirects these to the unchanged pay state with `discountCodeError=referral-already-attributed` or `referral-ineligible` (`features/checkout/discount-code-rejection.ts`).
  - `unavailable` or `pricing_changed`. Every other referral failure stays `unavailable`, so the response doesn't reveal whether a code or account exists.
- The ordinary submitted-code slot remains available. Once an ordinary code is applied, the code field closes, so customers enter a referral code first.

## Pricing and snapshots

Pricing is a pure read of accepted attribution and current eligibility. It never creates share codes, accepts referrals, or reserves claims. Apply ordinary and customer discounts first, then the 15% invitation candidate, then the referrer's fixed-money candidate calculated from the exact remaining subtotal. Apply voucher credit after those referral adjustments so credit never reduces the benefit basis. Keep the voucher's independent claim instruction, and ensure its final application and payment commitment match the displayed order and amount.

Compute the referrer reduction as `1 - 19^n / 20^n` over integer minor units using `BigInt`, then round the total monetary benefit once. Never round a per-person percentage or cap the count. Omit a candidate whose rounded value is zero so a payable small subtotal does not fail admission.

Keep invitation and referrer applications distinct, with stable IDs, localized labels, and provenance. The invitation application carries the durable claim instruction; accepted payment snapshots preserve the exact accepted label and amount. Use the shared discount quote and immutable accounting snapshot flow rather than a referral-specific checkout total.

Checkout referral acceptance deliberately mutates attribution, then rebuilds the signed quote. The acceptance seam may treat the first invitation application as the expected price change only when undiscounted items and amounts plus every non-referral application still match. The invitation must be the current customer's exact 15% application. An existing referrer application may recalculate only when its count label and provenance count are unchanged and both fixed amounts match the exact formula on their respective subtotals. Compare the resulting total as well; any unexplained difference, ordinary-code drift, base-price change, or referrer-count change remains `pricing_changed`. A retry with the original signed token uses the same narrow comparison and returns a usable refreshed invitation quote. Keep this comparison private to checkout acceptance.

The discount action owns the validated `referralApplied=1` success marker. It appears only for accepted or idempotently accepted relationships, and the page shows the localized fixed-15% notice only when the signed quote contains the invitation application. Referral input stays out of `submittedCode`; a normal code application rebuilds the URL without the marker.

## Persistence and payment lifecycle

`db/schema/referrals.ts` owns the durable referral code, attribution, and invitation-claim tables. Referral codes are rows in the shared `promotion_codes` registry with explicit `kind = 'referral'`; registry kind, not lexical shape, decides code dispatch. Attribution uses opaque Dotypos customer IDs, so auth-account deletion cannot erase eligibility or payment history. Keep referral claims in their own ledger, independent of ordinary code-redemption claims and vouchers.

`referralInvitationClaims` has one active (`reserved` or `redeemed`) claim per invited customer. Reserve it in the same transaction as the payment attempt and discount applications; redeem on local paid transition; release on failure, cancellation, or expiry. Late recovery must atomically readmit a released claim and reject it when another attempt has consumed or reserved the invitation. Normal first-booking admissions and paid transitions use the same invited-customer lock so an ordinary attempt cannot race past a reserved invitation. Customers without an accepted invitation retain normal concurrent ordinary payments; customers with prior local paid evidence retain ordinary repeat-booking behavior.

For attribution, use `withTransactionPermit` before opening one database transaction. Acquire the graph advisory lock first, then involved account locks in sorted account-ID order, then the invited customer's first-booking lock through that transaction. Recheck linked identities and account activity, read local booking history and graph state, and insert attribution through the same transaction executor; only Dotypos history retrieval is external. Do not call pooled database or account-link repository methods after taking transaction locks. This keeps the shared advisory-lock semaphore in force while avoiding an extra pooled connection after lock acquisition. Payment lifecycle and late-recovery transactions acquire the customer first-booking advisory lock before locking reservation or attempt rows. Keep this order consistent across admission, paid, terminal release, and recovery paths.

## Tests and migration

Keep exact-money and eligibility rules in focused pure tests. Use service Postgres tests for concurrent cycle acceptance, active-account checks, Dotypos/local-history evidence, and auth deletion or relinking. Use checkout lifecycle Postgres tests for both admission orders and races, ordinary-code/voucher coexistence, terminal release and retry, consumed claims, and late-recovery conflicts. Run database suites serially against the disposable `WORKSPACE_TEST_DATABASE_URL`.

Generate additive schema changes with `bun run db:generate` from `apps/deskohub-workspace` after the final schema is stable. Keep the generated migration, snapshot, and journal produced by Drizzle tooling together; never hand-edit generated migration metadata.
