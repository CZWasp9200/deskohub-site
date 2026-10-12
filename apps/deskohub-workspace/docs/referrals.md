# Workspace referrals

Workspace customers can invite new customers through a personal share link or by sharing their referral code. All entry points follow the same eligibility and attribution rules.

## Referral sources

A customer's referral can come from exactly three sources:

- **Profile completion.** When a customer signs in for the first time, the profile-completion form has an optional referral code field. A code entered there becomes the customer's referral when the profile is saved, and the invitation discount then applies automatically to their first booking. The customer doesn't enter the code again at checkout. An unusable code is reported on the field, so the customer can correct or remove it before saving.
- **Checkout code field.** A referral code entered in the existing checkout code field, which is shared with ordinary discount codes, applies the referral to the current booking when the customer is eligible.
- **Share link.** The share link carries the code in the address. On a first-time sign-in, the profile-completion referral field is pre-filled with the code. When a signed-in customer starts a reservation from an address that carries a code, checkout applies it automatically. A link code that can't be used is ignored without blocking sign-up or checkout.

There is no separate step for accepting an invitation.

## Attribution and eligibility

A referral requires a verified customer account linked to a Workspace customer. It is set once, between account creation and the customer's first booking, and never changes afterwards. Submitting the same referral again is harmless. Changing referrer, referring yourself, and forming a referral cycle are rejected. At checkout, a different referral code for a customer who already has a referrer is rejected with an explanation. A customer whose profile is already complete can still get a referral, but only through checkout on their first booking. A customer with an earlier booking can't get one at all.

An invited customer receives a 15% discount on their first paid Workspace booking. A customer with any earlier locally recorded paid Workspace booking is ineligible, including a booking made before account signup. An older confirmed Dotypos reservation without local payment evidence also excludes that customer. An unpaid checkout hold does not count as an earlier paid booking.

The first-booking benefit can be reserved by only one checkout at a time. Failed, cancelled, or expired payment attempts release it. Successful payment consumes it permanently. Payment retries and late-payment recovery cannot grant it to two bookings or reset an already consumed benefit.

## Referrer discount

The referrer's current discount depends on distinct invited customers who have a qualifying visit in the trailing 30 days. A qualifying visit is a paid Workspace reservation whose end time has passed and whose reservation has not been cancelled. A person contributes at most once; a later qualifying visit refreshes their eligibility.

For `n` eligible people, the remaining price multiplier is `0.95^n`. The discount is `1 - 0.95^n`: 5% for one person, 9.75% for two, and 14.2625% for three. There is no separate program cap. The monetary benefit is rounded once to the currency's smallest unit.

The window ends at the current checkout time and expires each visit's contribution after exactly 30 elapsed days. Eligibility is recalculated at checkout. Local paid status is authoritative for payment eligibility; this program does not query the payment provider for refunds. An externally refunded booking may therefore continue to count until its existing local payment or reservation state reflects disqualification.

## Checkout

Both referral benefits apply to Workspace reservation families under their existing discountable-price rules. They compound with sales, ordinary codes, and customer discounts using the existing pricing rules. Vouchers continue to apply as credit. A customer may receive both referral benefits when eligible for both.

Customer-specific referral discounts appear after customer identity is resolved. A change in referral eligibility after the customer reviews a price requires an updated price to be accepted before payment begins. Completed bookings preserve the accepted labels and monetary discounts.

Entering a referral code in checkout requires a verified account and the same eligibility checks as every other source. It cannot attribute another customer's booking, replace an existing referrer, bypass a previous booking, or apply the invitation benefit twice. Ordinary codes and vouchers remain usable alongside a referral relationship. The checkout code field takes one code at a time: a customer who wants both should enter the referral code first, then the ordinary code.

## Customer account

The account has a referral section showing the customer's share link and code, the current referrer discount, the number of currently eligible invited people out of everyone they have invited, and the amount saved through referrals so far. Savings add up both referral benefits on the customer's own bookings whose payment succeeded and was not refunded or marked for refund, totalled per currency. The section explains the first-booking 15% benefit, the trailing 30-day rule, how the discount compounds, and what the savings include. Counts do not disclose other customers' profile details. The section does not accept other customers' codes.

Referral relationships and prior paid-booking evidence use the existing customer identity. Deleting an authentication account does not erase paid history, reset first-booking eligibility, or rewrite accepted discounts. A referral code cannot be used while its owner's account is unavailable or being deleted.

## First-release scope

The invitation benefit is fixed at 15%, and each eligible invited person contributes a compounding 5% reduction. This release has no editable reward settings, manual reward overrides, or automatic invitation emails. Boardgame Bar referrals are outside scope.
