import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type {
  CustomerCheckout,
  CustomerPaymentRetryDetails,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { BookingProblem } from "../checkout/booking-problem";
import {
  startCheckout,
  startPaymentRetry,
  step,
} from "../checkout/checkout-machine";
import {
  type CheckoutCommand,
  type CheckoutDetails,
  CheckoutEvent,
  type CheckoutState,
  type ReviewState,
} from "../checkout/checkout-state";
import {
  pricedLines,
  sampleLegalDocuments,
  sampleSummary,
} from "../testing/sample-booking-catalog";
import { reviewView } from "./review-view";

const selection = {
  family: "cowork",
  date: "2026-11-20",
  tier: "open-space",
  coffee: true,
} as const;

const summary = sampleSummary({ lines: pricedLines(selection) });
const documents = sampleLegalDocuments("en-US", 1);

const held = (overrides: Partial<CustomerCheckout> = {}): CustomerCheckout => ({
  status: "ready",
  orderId: "order-1",
  payStateToken: "token-1",
  // The token outlives the hold here, so the countdown proves which it uses.
  expiresAt: "2026-11-20T09:20:00.000Z",
  holdExpiresAt: "2026-11-20T09:10:00.000Z",
  summary,
  earlyPerformanceConsent: {
    required: false,
    requiredFrom: "2026-12-04T09:00:00.000Z",
  },
  ...overrides,
});

interface Run {
  readonly state: CheckoutState;
  readonly commands: ReadonlyArray<CheckoutCommand>;
}

const run = (state: CheckoutState, ...events: ReadonlyArray<CheckoutEvent>) =>
  events.reduce<Run>(
    (previous, event) => {
      const next = step(previous.state, event);
      return {
        state: next.state,
        commands: [...previous.commands, ...next.commands],
      };
    },
    { state, commands: [] }
  );

const operationOf = (result: Run, tag: CheckoutCommand["_tag"]) => {
  const command = result.commands.findLast((sent) => sent._tag === tag);
  if (command === undefined || !("operationId" in command)) {
    throw new Error(`no ${tag} command`);
  }
  return command.operationId;
};

const asReview = (state: CheckoutState): ReviewState => {
  if (state._tag !== "Review") throw new Error(`not in Review: ${state._tag}`);
  return state;
};

const start = startCheckout({
  checkoutSessionId: "session-1",
  locale: "en-US",
  selection,
  advertisedPriceToken: "advertised-1",
  rememberedReferralCode: Option.none(),
});

const selfDetails: CheckoutDetails = {
  bookingFor: "self",
  contact: {
    name: "Synthetic Booker",
    email: testEmailAddress("booker"),
    phone: "+420700000000",
  },
  billing: { purpose: "personal", invoice: "none" },
};

const address = {
  line1: "Synthetic Street 1",
  city: "Synthetic City",
  postalCode: "11000",
  country: "CZ",
};

/** A held checkout in Review, legal documents loaded unless told otherwise. */
const reviewWith = (
  checkout: CustomerCheckout,
  {
    loadLegal = true,
    details = selfDetails,
  }: { readonly loadLegal?: boolean; readonly details?: CheckoutDetails } = {}
): Run => {
  const continued = run(
    start,
    CheckoutEvent.Continue({ checkoutAttemptId: "attempt-1", details })
  );
  const created = run(
    continued.state,
    CheckoutEvent.CheckoutCreated({
      operationId: operationOf(continued, "CreateCheckout"),
      start: checkout,
    })
  );
  const all = {
    state: created.state,
    commands: [...continued.commands, ...created.commands],
  };
  if (!loadLegal) return all;
  const loaded = run(
    all.state,
    CheckoutEvent.LegalDocumentsLoaded({
      operationId: operationOf(all, "LoadLegalDocuments"),
      documents,
    })
  );
  return {
    state: loaded.state,
    commands: [...all.commands, ...loaded.commands],
  };
};

/** An order paid again in place, at its review with the terms loaded. */
/** A retried order booked for a guest, invoiced to the customer. */
const retryDetails: CustomerPaymentRetryDetails = {
  bookingFor: "someone-else",
  contact: { name: "Synthetic Guest", email: testEmailAddress("guest") },
  billing: { purpose: "personal", invoice: "requested", city: address.city },
};

const retryReview = (checkout: CustomerCheckout): Run => {
  const started = startPaymentRetry(
    {
      checkoutSessionId: "session-3",
      locale: "en-US",
      selection,
      advertisedPriceToken: "",
      rememberedReferralCode: Option.none(),
    },
    checkout,
    retryDetails
  );
  return run(
    started.state,
    CheckoutEvent.LegalDocumentsLoaded({
      operationId: operationOf(
        { state: started.state, commands: started.commands },
        "LoadLegalDocuments"
      ),
      documents,
    })
  );
};

const quoted = summary.total;
const noBooker = Option.none<string>();
const viewOf = (result: Run, bookerName = noBooker) =>
  reviewView(asReview(result.state), quoted, bookerName);

/** A summary whose total differs from the quote's. */
const discounted = sampleSummary({
  lines: pricedLines(selection),
  discountShare: 0.1,
  discountLabel: "SAVE10",
});

const applyCode = (from: Run, input: string) => {
  const typed = run(from.state, CheckoutEvent.CodeChanged({ input }));
  const applying = run(typed.state, CheckoutEvent.ApplyCode());
  return {
    applying,
    operationId: operationOf(applying, "ApplyDiscountCode"),
  };
};

/** A meeting room review, with or without early setup. */
const meetingRoomReview = (earlySetup: boolean) => {
  const meetingRoom = {
    family: "meeting-room",
    date: "2026-11-20",
    duration: "hour:1",
    startTime: "14:00",
  } as const;
  const started = startCheckout({
    checkoutSessionId: "session-2",
    locale: "en-US",
    selection: meetingRoom,
    advertisedPriceToken: "advertised-2",
    rememberedReferralCode: Option.none(),
    earlySetup,
  });
  const continued = run(
    started,
    CheckoutEvent.Continue({
      checkoutAttemptId: "attempt-2",
      details: selfDetails,
    })
  );
  return run(
    continued.state,
    CheckoutEvent.CheckoutCreated({
      operationId: operationOf(continued, "CreateCheckout"),
      start: held({
        summary: sampleSummary({ lines: pricedLines(meetingRoom) }),
      }),
    })
  );
};

describe("reviewView", () => {
  test("a retried order shows the details the server kept, terms confirmed again, Pay waits for them", () => {
    const view = viewOf(retryReview(held()), Option.some("Synthetic Booker"));
    expect(view.retry).toBe(true);
    expect(view.consent.retry).toBe(true);
    expect(view.party).toEqual({
      _tag: "SomeoneElse",
      name: "Synthetic Guest",
      email: testEmailAddress("guest"),
      bookerName: Option.some("Synthetic Booker"),
    });
    expect(view.invoice).toEqual({ _tag: "Personal", city: "Synthetic City" });
    expect(view.payBlock).toEqual(Option.some("Agreement"));
    const agreed = viewOf(
      run(
        retryReview(held()).state,
        CheckoutEvent.ToggleConsent({ accepted: true })
      )
    );
    expect(agreed.canPay).toBe(true);
  });

  test("a retried order whose price changed asks to accept it first", () => {
    const view = viewOf(
      retryReview(
        held({
          status: "price_review",
          summary: discounted,
          priceReview: {
            changedKeys: { sectionKeys: ["total"], itemKeys: [] },
          },
        })
      )
    );
    expect(Option.isSome(view.priceChange)).toBe(true);
    expect(view.payBlock).toEqual(Option.some("AcceptPrice"));
  });

  test("a meeting room booked with early setup says so; without it, or for a desk, it doesn't", () => {
    expect(viewOf(meetingRoomReview(true)).earlySetup).toBe(true);
    expect(viewOf(meetingRoomReview(false)).earlySetup).toBe(false);
    expect(viewOf(reviewWith(held())).earlySetup).toBe(false);
  });

  test("opens on the booking, the server's price and the quiet code row; Pay waits for the agreement", () => {
    const view = viewOf(reviewWith(held()));
    expect(view.party).toEqual({ _tag: "Self", name: "Synthetic Booker" });
    expect(view.invoice).toEqual({ _tag: "None" });
    expect(view.retry).toBe(false);
    expect(view.price.breakdown.total).toEqual(summary.total);
    expect(view.price.breakdown.lines.length).toBeGreaterThan(0);
    expect(view.price.was).toEqual(Option.none());
    expect(view.priceChange).toEqual(Option.none());
    expect(view.code).toMatchObject({ _tag: "Entry", startsOpen: false });
    expect(view.payBlock).toEqual(Option.some("Agreement"));
    expect(view.canPay).toBe(false);
  });

  test("names a guest with their email and the booker, and a company invoice by its name", () => {
    const view = viewOf(
      reviewWith(held(), {
        details: {
          bookingFor: "someone-else",
          contact: {
            name: "Synthetic Guest",
            email: testEmailAddress("guest"),
            phone: "+420700000001",
          },
          billing: {
            purpose: "business",
            invoice: "required",
            buyer: {
              kind: "business",
              legalName: "Synthetic Studio s.r.o.",
              companyId: "12345678",
              address,
            },
          },
        },
      }),
      Option.some("Synthetic Booker")
    );
    expect(view.party).toEqual({
      _tag: "SomeoneElse",
      name: "Synthetic Guest",
      email: testEmailAddress("guest"),
      bookerName: Option.some("Synthetic Booker"),
    });
    expect(view.invoice).toEqual({
      _tag: "Company",
      legalName: "Synthetic Studio s.r.o.",
    });
  });

  test("lists an office's people from the held checkout: the contact while attending, then the invited addresses", () => {
    const people = {
      contactAttends: true,
      invitees: [testEmailAddress("jana.novak")],
    };
    expect(viewOf(reviewWith(held({ people }))).people).toEqual(
      Option.some({
        contact: Option.some({
          name: selfDetails.contact.name,
          email: selfDetails.contact.email,
          you: true,
        }),
        invitees: [testEmailAddress("jana.novak")],
      })
    );
    const away = viewOf(
      reviewWith(held({ people: { ...people, contactAttends: false } }))
    ).people;
    expect(Option.map(away, ({ contact }) => Option.isNone(contact))).toEqual(
      Option.some(true)
    );
    expect(viewOf(reviewWith(held())).people).toEqual(Option.none());
  });

  test("a personal invoice is shown by its city", () => {
    const view = viewOf(
      reviewWith(held(), {
        details: {
          ...selfDetails,
          billing: { purpose: "personal", invoice: "requested", address },
        },
      })
    );
    expect(view.invoice).toEqual({ _tag: "Personal", city: "Synthetic City" });
  });

  test("a changed price shows the quote's total and the new one, and Pay waits for the acceptance", () => {
    const changed = reviewWith(
      held({
        status: "price_review",
        summary: discounted,
        priceReview: {
          changedKeys: { sectionKeys: ["total"], itemKeys: [] },
        },
      })
    );
    const ticked = run(
      changed.state,
      CheckoutEvent.ToggleConsent({ accepted: true })
    );
    const view = viewOf(ticked);
    expect(view.priceChange).toEqual(
      Option.some({ before: quoted, now: discounted.total, accepting: false })
    );
    expect(view.price.was).toEqual(Option.some(quoted));
    expect(view.payBlock).toEqual(Option.some("AcceptPrice"));
    expect(view.canPay).toBe(false);

    const accepting = run(ticked.state, CheckoutEvent.AcceptPrice());
    const pending = viewOf(accepting);
    expect(
      Option.map(pending.priceChange, (change) => change.accepting)
    ).toEqual(Option.some(true));
    expect(pending.payBlock).toEqual(Option.some("AcceptPrice"));

    const accepted = run(
      accepting.state,
      CheckoutEvent.PriceAccepted({
        operationId: operationOf(accepting, "AcceptPriceChange"),
        checkout: held({ payStateToken: "token-2", summary: discounted }),
      })
    );
    const settled = viewOf(accepted);
    expect(settled.priceChange).toEqual(Option.none());
    expect(settled.price.was).toEqual(Option.some(quoted));
    expect(settled.canPay).toBe(true);
    expect(settled.payBlock).toEqual(Option.none());
  });

  test("a price review after a removed code compares against the total last shown, not the quote's", () => {
    const appliedDiscountCode = { code: "SAVE10", discountId: "sample-code" };
    const applied = reviewWith(
      held({ summary: discounted, appliedDiscountCode })
    );
    const clearing = run(applied.state, CheckoutEvent.ClearCode());
    const cleared = run(
      clearing.state,
      CheckoutEvent.CodeCleared({
        operationId: operationOf(clearing, "ClearDiscountCode"),
        checkout: held({
          status: "price_review",
          payStateToken: "token-2",
          priceReview: {
            changedKeys: { sectionKeys: ["total"], itemKeys: [] },
          },
        }),
      })
    );
    expect(viewOf(cleared).priceChange).toEqual(
      Option.some({
        before: discounted.total,
        now: summary.total,
        accepting: false,
      })
    );
  });

  test("code entry opens with an input, holds still while applying, and shows the server's refusal at the field", () => {
    const loaded = reviewWith(held());
    const typed = run(
      loaded.state,
      CheckoutEvent.CodeChanged({ input: "OLD" })
    );
    expect(viewOf(typed).code).toMatchObject({
      _tag: "Entry",
      startsOpen: true,
      canApply: true,
      problem: Option.none(),
    });

    const { applying, operationId } = applyCode(loaded, "OLD");
    const pending = viewOf(applying);
    expect(pending.code).toMatchObject({
      _tag: "Entry",
      applying: true,
      editable: false,
      canApply: false,
    });
    expect(pending.busy).toBe(true);
    expect(pending.payBlock).toEqual(Option.some("Agreement"));

    const refusedWith = (reason: "ineligible" | "unavailable") =>
      viewOf(
        run(
          applying.state,
          CheckoutEvent.CommandFailed({
            operationId,
            problem: BookingProblem.CodeRejected({
              reason,
              replacement: Option.none(),
            }),
          })
        )
      ).code;
    expect(refusedWith("ineligible")).toMatchObject({
      _tag: "Entry",
      startsOpen: true,
      input: "OLD",
      problem: Option.some({ _tag: "Rejected", reason: "ineligible" }),
    });
    expect(refusedWith("unavailable")).toMatchObject({
      _tag: "Entry",
      canApply: true,
      problem: Option.some({ _tag: "Retryable" }),
    });
  });

  test("an applied code is a chip; Remove only while the server's entered code can be cleared", () => {
    const appliedDiscountCode = { code: "SAVE10", discountId: "sample-code" };
    const { applying, operationId } = applyCode(reviewWith(held()), "save10");
    const applied = run(
      applying.state,
      CheckoutEvent.CodeApplied({
        operationId,
        result: {
          ...held({
            payStateToken: "token-2",
            summary: discounted,
            appliedDiscountCode,
          }),
          discountCode: "applied",
        },
      })
    );
    const view = viewOf(applied);
    expect(view.code).toEqual({
      _tag: "Applied",
      code: "SAVE10",
      canClear: true,
      clearing: false,
    });
    expect(view.price.was).toEqual(Option.some(quoted));

    const clearing = run(applied.state, CheckoutEvent.ClearCode());
    expect(viewOf(clearing).code).toMatchObject({
      _tag: "Applied",
      canClear: false,
      clearing: true,
    });
    const cleared = run(
      clearing.state,
      CheckoutEvent.CodeCleared({
        operationId: operationOf(clearing, "ClearDiscountCode"),
        checkout: held({ payStateToken: "token-3" }),
      })
    );
    expect(viewOf(cleared).code).toMatchObject({
      _tag: "Entry",
      startsOpen: false,
    });

    // A referral the server accepted isn't an entered code it can remove.
    const referral = applyCode(reviewWith(held()), "FRIEND");
    const accepted = run(
      referral.applying.state,
      CheckoutEvent.CodeApplied({
        operationId: referral.operationId,
        result: {
          ...held({ payStateToken: "token-2", referralApplied: true }),
          discountCode: "referral_accepted",
        },
      })
    );
    expect(viewOf(accepted).code).toEqual({
      _tag: "Applied",
      code: "FRIEND",
      canClear: false,
      clearing: false,
    });

    // While a price review waits, the code stays in the price.
    const reviewing = reviewWith(
      held({
        status: "price_review",
        appliedDiscountCode,
        priceReview: {
          changedKeys: { sectionKeys: ["total"], itemKeys: [] },
        },
      })
    );
    expect(viewOf(reviewing).code).toMatchObject({
      _tag: "Applied",
      canClear: false,
    });
  });

  test("the hold deadline is the server's: the same holdExpiresAt keeps it, a new one moves it", () => {
    const loaded = reviewWith(held());
    const deadline = viewOf(loaded).holdExpiresAt;
    const answer = (holdExpiresAt: string) => {
      const { applying, operationId } = applyCode(loaded, "SAVE10");
      return viewOf(
        run(
          applying.state,
          CheckoutEvent.CodeApplied({
            operationId,
            result: {
              // A code renews the token, with a later expiry of its own.
              ...held({
                payStateToken: "token-2",
                expiresAt: "2026-11-20T09:30:00.000Z",
                holdExpiresAt,
              }),
              discountCode: "applied",
            },
          })
        )
      ).holdExpiresAt;
    };
    expect(answer(deadline)).toBe(deadline);
    expect(answer("2026-11-20T09:25:00.000Z")).toBe("2026-11-20T09:25:00.000Z");
  });

  test("Pay opens once the agreement is ticked, and holds still while submitting", () => {
    const ticked = run(
      reviewWith(held()).state,
      CheckoutEvent.ToggleConsent({ accepted: true })
    );
    const ready = viewOf(ticked);
    expect(ready.canPay).toBe(true);
    expect(ready.payBlock).toEqual(Option.none());

    const paying = viewOf(run(ticked.state, CheckoutEvent.Pay()));
    expect(paying.submitting).toBe(true);
    expect(paying.canPay).toBe(false);
    expect(paying.payBlock).toEqual(Option.none());
  });
});
