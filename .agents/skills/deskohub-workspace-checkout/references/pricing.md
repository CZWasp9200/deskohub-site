# Checkout pricing

Customer-facing price policy lives in the [checkout specification](../../../../apps/deskohub-workspace/docs/checkout-lifecycle.md) and the [discount specification](../../../../apps/deskohub-workspace/docs/discount-codes.md). Calendar sale eligibility belongs to the domain skill's [sales calendar reference](../../deskohub-workspace-domain/references/sales-calendar.md). This file covers how the code enforces them.

## Price boundaries

Checkout has three price boundaries. Each one affirms what the previous one showed:

1. **Advertisement.** The reservation page shows a price and issues an integrity-protected advertisement snapshot.
2. **Signed summary.** Reservation submission opens the snapshot, builds the authoritative quote, and signs the order summary into the Pay state.
3. **Payment.** Order submission freshly affirms the signed summary before any payment attempt exists.

Any change to price facts accepted at the previous boundary returns `pricing_changed` with the affected product keys (for example `product:cowork:basic`) and a refreshed signed summary. `pricing_changed` is a normal workflow result, not a failure.

`CheckoutPricingService` judges every boundary and returns a `PriceVerdict` (`price-verdict.ts`), each operation with its own rule: `affirmAdvertisement`, `quoteForCustomer`, `applyDiscountCode`, and `affirmForPayment`. Callers branch on the verdict and never compare quotes or build changed keys. Only two judgments stay outside: referral acceptance's expected-addition rule (referrals skill) and claim-admission recovery, which uses `repriceForPayment`, judges nothing, and always shows the keys from the signed summary to the re-priced one.

### Advertisement

- Evaluate only anonymously discoverable pricing: Calendar sales and, when the URL supplies `discountCode`, the public part of an ordinary code. Exclude vouchers.
- Never resolve or create a Dotypos customer to advertise a price. The snapshot holds no PII and no customer-pricing marker.
- Put only amount-determining inputs in advertised-price requests, snapshots, quote items, fingerprints, and query keys. Cowork monitor selection, reservation purpose, and billing details stay out. Keep them in reservation validation, availability, table assignment, and the signed reservation state.
- If anonymous discovery fails before render, log it and advertise without that discount.

### Reservation submission

- Affirm only the anonymous discounts that were advertised. Never add one that became available after the snapshot.
- After Dotypos identity resolution, fully validate a query code and evaluate the customer discount. A query code that fails validation yields a summary without it. The customer discount may appear for the first time here without `pricing_changed`. This exception applies to nothing else.
- Once a discount appears in a signed summary, it follows the normal affirmation and `pricing_changed` rules everywhere.
- `quoteForCustomer` takes the advertisement's verdict. It returns `pricing_changed` when that verdict did, or when full validation dropped or changed an advertised query code. Its keys run from the advertised quote's summary to the customer quote's.

### Discount-code entry

The summary page's code form is an independent action (`features/checkout/actions/apply-discount-code.ts`, with `clear-discount-code.ts` for its Remove control). Both are thin adapters, like the customer API's handlers, over the shared Pay-state operations `applyDiscountCodeToPayState` and `clearDiscountCodeFromPayState` in `features/checkout/backend/checkout/pay-state-discount-code.ts`. They never resubmit the reservation or the order.

1. Affirm every displayed discount. A changed fingerprint or total returns `pricing_changed` with the refreshed price and no code. `applyDiscountCode`'s `affirmed` verdict carries the code's priced order.
2. An invalid or unavailable code returns a field error and leaves the current summary payable.
3. A valid code returns a new signed summary. It creates no payment attempt, persists no application, and reserves no capacity.
4. Ordinary and referral codes are priced between two live payable-reservation guards. An active payment attempt at either guard returns `payment_in_progress` and signs no repriced summary.
5. A referral verdict (inactive, unknown, self-referral and the like) is a code failure. A referral store or Dotypos outage reaches no verdict and is a provider failure the customer can retry, never an unavailable code.

Removing an entered code (`clearDiscountCodeFromPayState`) shares entry's live guards (`priceBetweenPayableGuards`), unavailable mapping, signed `bookedAt` and deadline:

1. No `submittedCode` and no `requestedDiscountCode`: return the caller's token as `unchanged`. It signs nothing and reads no reservation, like accepting a price that needs no review, so a retry after a lost response is safe; payment checks the reservation again.
2. An applied or an intended code with `changedKeys` pending: `price_review_pending`, before any guard. The customer accepts the reviewed price first.
3. Only a `requestedDiscountCode`: after one live payable guard, reissue without it. No repricing.
4. An applied code: `CheckoutPricingService.clearDiscountCode` affirms every displayed discount except `submittedCodeDiscountId` through `affirmDisplayedDiscounts`, so `selectAffirmedCandidates` decides as at payment and the kept discounts are stacked afresh, never by taking the code's amount back off. The referral benefit is affirmed with them through `referralCode`. Reissue without `submittedCode`, `submittedCodeDiscountId` and `requestedDiscountCode`, with the new quote (and so its `acceptedTotal`) and `changedKeys` from the signed summary to the new one, so the customer accepts the price before paying. A code that changed no summary key signs no review.

Both reissue through `PayState.reissue` (`requested_code_cleared` and `code_cleared`), on a state given its `holdExpiresAt` by `withPayStateHoldExpiry`; neither operation moves the hold.

### Removing an entered code

`clearDiscountCodeFromPayState` (`features/checkout/backend/checkout/pay-state-discount-code.ts`) is the one removal operation; the site's `clearDiscountCodeForm` and the customer API's `clearCheckoutDiscountCode` are adapters over it.

1. A state with no applied and no intended code returns its own token unchanged, so a retried removal is safe.
2. An intended code that never applied is dropped after the live payable guard, without repricing.
3. An applied code is removed by `CheckoutPricingService.clearDiscountCode` between the same two live payable-reservation guards as code entry, under the same deadline (`getDiscountCodeChangeDeadline`). It re-affirms every displayed discount except the code's (`removedDiscountId`) and stacks them afresh; it never subtracts the code's amount. An unknown retained discount is a retryable provider failure that signs nothing.
4. The replacement drops `submittedCode`, `submittedCodeDiscountId` and `requestedDiscountCode`, keeps `referralCode`, and carries the summary's `changedKeys`, so the customer accepts the new price through the ordinary acceptance flow before paying. A pending price review refuses removal of an applied or an intended code.

### Hold deadline

Every Pay state signs `holdExpiresAt`, the reservation's stored `reservation_hold_expires_at`, separately from the token's own `exp`. Every issue copies it from the stored reservation, and `PayState.reissue` takes only a `PayStateWithHoldExpiry` and carries its deadline into every outcome; an opened state gets it from `withPayStateHoldExpiry` or `loadPayStateHoldExpiry` (`pay-state-hold.ts`). Never recompute it from the token TTL. A token issued before the claim existed reads it from the stored reservation. `PayableCheckout` (`open`, `reconfirm`) remains the authority that refuses an ended hold, and its `OpenCheckout.state` already carries the deadline.

Keep `submittedCode` and `changedKeys` in the common signed Pay-state envelope. Issue a new order's Pay state with `PayState.issue` and replace an open one only with `PayState.reissue(state, outcome)` (`pay-state.ts`): each outcome owns the fields it carries forward, so callers never assemble a replacement's fields by hand. `referral_applied` deliberately drops `requestedDiscountCode`: the customer entered the referral through the same discount-code field, so carrying the earlier code would refill that field with a code the customer moved past and leave a stale removable intended code. Every reservation family quotes and affirms through its own canonical product identity; dispatch family-owned quote, summary, persistence, and checkout-details projections exhaustively, with no implicit cowork default.

### Payment

The accepted payment amount must equal the last signed summary total exactly. Order submission affirms exactly the signed discounts and compares the full quote fingerprint and total. A mismatch, or a failure to persist applications or admit a claim, returns `pricing_changed`, rolls back, and never calls Nexi.

Order submission and referral acceptance branch on `affirmForPayment`'s verdict; referral acceptance adds its expected-addition rule on top of it.

- Positive total: create a Nexi attempt and HPP session.
- Zero total: in one transaction insert an already-paid `internal` attempt, mark the reservation paid, persist application snapshots, and redeem any admitted claim. Never call Nexi.

Persist discount applications and admit code or voucher claims in the payment-attempt creation transaction. Redeem in the paid transaction; release in every failed, cancelled, or expired transaction. Any application or claim error is fatal to its owning transition. Never convert it to an empty discount result or `not_pending`. Voucher admission locks the voucher row and rechecks the exact available amount in that transaction.

Promotion availability rules (enabled, validity window, service dates, allowlist, use limits, a voucher's reserved claim and remaining credit) live once, in `evaluatePromotionAvailability` (`features/discounts/promotion-availability.ts`). It is pure: callers pass the facts, including the instant. `PromotionCodeProvider`, claim admission (`PromotionClaims.admit`) and late-recovery readmission of a released code claim (`PromotionClaims.redeem` with `readmitReleased`) each run named stages from `promotionAvailabilityPrecedence`, which fixes their rule order and so which reason wins when several rules fail; pricing and admission order the rules differently on purpose. `PromotionCodeRepository`, admission and readmission all read allowlist, use-count and used-credit facts with the readers in `promotion-code.repository-query.ts` (`readPromotionAudience`, `readDiscountCodeUses`, `readVoucherUses`); admission and readmission pass the transaction's `db` and read after taking their row locks. Product targeting, the hold deadline, the stored-benefit and accepted-credit comparisons, and the claim-customer match stay outside the evaluator, in `PromotionClaims`.

`PromotionClaims` (`features/discounts/promotion-claims.ts`) is the discount-code and voucher claim ledger and the only writer of `discount_code_redemptions` and `voucher_redemptions`. `admit`, `redeem` and `release` are steps of the caller's Workspace transaction: they require `WorkspaceTransaction`, open none, and take only row locks, which last until that transaction ends. The caller owns the advisory locks and the order of the steps: the payment lifecycle validates the commitment (one claim per ledger, application money, the claimed product, the first service date) before its transaction and admits, redeems or releases the code or voucher claim before the referral invitation claim, and reservation administration cancellation releases through `release`. `admit` reports an ended hold as `PromotionClaimHoldEndedError`, which the lifecycle reports as its own state error, and its own lost active-claim races as `claim_conflict`. Referral invitation claims keep their own ledger, `ReferralInvitationLedger` (referrals skill).

## Unknown discounts

A displayed or advertised discount is **gone** only when every provider resolved completely and none returned it. `PromotionCodeUnavailableError` and a disabled release gate are complete answers.

When a provider fails or resolves incompletely (Calendar `complete: false`) and a displayed discount is unmatched, the discount is **unknown**. `selectAffirmedCandidates` in `features/discounts/discount.service.ts` fails with `DiscountAffirmationUnavailableError`:

- Reservation submission, order submission, and the post-identity query-code check surface it as a retryable `PublicSafeActionError`. The customer retries the unchanged summary.
- Discount-code entry and removal treat it as a provider failure the customer can retry and leave the summary payable.
- Never answer it with `pricing_changed`, a re-signed summary, or a payment attempt.
- Never fall back to an earlier Calendar read. Affirmation (`CalendarDiscountProvider.revalidate`) always reads Google Calendar directly. Only advertisement discovery uses the shared cache.

Provider failures that leave every displayed discount matched don't block affirmation.

## Booking instant

A Calendar sale applies according to the booking instant. The eligibility rule itself is in the domain skill's [sales calendar reference](../../deskohub-workspace-domain/references/sales-calendar.md); this section covers only where the booking instant comes from.

- Advertisement and the home-page banner use the current instant.
- Reservation submission (`prepareWorkspacePayState`) captures the instant once and signs it into the Pay state as `bookedAt`. Re-signed Pay states carry it forward.
- Every later affirmation reads `PayState.bookedAt`, never the clock: summary acceptance, code entry, payment start, and claim-conflict refresh.
- Editing the reservation creates a new Pay state and a new booking instant. Never use the reservation draft's creation time.
- Webhook, finalization, and late-payment recovery read persisted application snapshots and never re-evaluate eligibility.

Meeting-room advertised-price details carry `lastServiceDate` rather than clock times, so the advertisement stays keyed by dates.

## Calendar time budgets

Each Calendar request attempt times out after 5 seconds in production and 15 seconds elsewhere (`getGoogleCalendarRequestTimeout`, selected with `byStage` from `shared/deployment/deployment-stage.ts`). `listEvents` retries a transient failure once and bounds the whole load, all pages included, by `getGoogleCalendarRequestWorstCaseDuration`.

An action that awaits Calendar in sequence with other work adds one worst-case load per sequential Calendar load to its deadline:

| Action | Deadline getter | Calendar loads |
| --- | --- | --- |
| Reservation submission | `getPreparePayStateDeadline` | 2 (sales affirmation, then availability limitations) |
| Discount-code entry and removal | `getDiscountCodeChangeDeadline` | 1, through `getCalendarActionDeadline` |
| Pay submit | `getCheckoutSubmitDeadline` | 1, plus one Dotypos and one Nexi request |

Count a Calendar load that runs in parallel with other work unless that work is reliably slower. The added budget covers one Calendar retry, not every provider being slow at once; that case ends in the retryable timeout error.

When you change a deadline, make the action select it through its getter and make its behavioral test use the same getter. Run the action on a test clock with a Calendar load that succeeds on retry; don't test deadline arithmetic.

## Quotes and summaries

- A quote holds priced items, payment totals, generic discount applications, and the fingerprint. It never embeds a summary or duplicates the reservation selection.
- The checkout summary is a family-owned projection of the signed reservation plus its quote. Zero-priced composition, such as the selected cowork monitor, belongs there.
- Pass canonical reservation projections into pricing. Use the reservation domain's PII-free details projection instead of intersecting fields such as `date` onto an incomplete product type.

## Currency

Keep the catalog currency through advertisement, signed summary, affirmation, and local payment attempts. Apply the non-production Nexi sandbox currency override only at Nexi call sites: HPP creation and verification arguments. It never changes customer-visible quotes or persisted payment facts and is unavailable in production.

## Money

Every Workspace amount is a `Money` from `apps/deskohub-workspace/shared/money/money.ts`: a scaled integer `value`, its decimal `exponent`, and an ISO `currency`. Build, combine, convert, and display amounts through that module instead of restating its rules:

- Check that amounts share a currency and exponent with `sameMoneyUnit`, and total them with `sumMoney`, which fails with `MoneyUnitMismatch`. Keep a separate currency or exponent check only where the caller reports which one differs.
- Convert exactly with `moneyToBigDecimal` and `moneyFromBigDecimal`, which fails with `MoneyPrecisionError` rather than rounding. Write plain decimal text with every minor digit, such as `125.50`, with `moneyToDecimalString`. Use `moneyMajorAmount` only where a JavaScript number is required, such as `Intl` or an external contract.
- Display amounts with `formatMoney(money, locale)` in customer pages, emails, and the administration alike.
