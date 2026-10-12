import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Context, Effect, Layer, Predicate } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";

let currentUserEffect: Effect.Effect<
  {
    readonly accountId: CustomerAccountId;
    readonly email: string;
    readonly deletionRequested: boolean;
  } | null,
  unknown
>;

const Authentication = Context.Service<
  Authentication,
  {
    readonly currentUser: typeof currentUserEffect;
  }
>()("@test/AccountAuthentication");

const AuthenticationLayer = Layer.effect(
  Authentication,
  Effect.succeed({
    get currentUser() {
      return currentUserEffect;
    },
  })
);
Object.assign(Authentication, {
  Default: AuthenticationLayer,
  Live: AuthenticationLayer,
});

const accountId = "auth-account-1" as CustomerAccountId;
const activeSession = {
  accountId,
  email: "ada@example.test",
  deletionRequested: false,
};

let resolveEffect: Effect.Effect<
  {
    readonly account: {
      readonly accountId: CustomerAccountId;
      readonly dotyposCustomerId: string;
    };
    readonly autoLinked: boolean;
  },
  { readonly reason: string; readonly linkReason?: string }
>;
let resolverCalls = 0;
let events: string[] = [];
let profileLoadCalls = 0;
let historyLoadCalls = 0;
let avatarLookupCalls = 0;

const Resolver = Context.Service<
  Resolver,
  { readonly resolve: () => typeof resolveEffect }
>()("@test/AccountResolver");

const ResolverLayer = Layer.succeed(Resolver, {
  resolve: () => resolveEffect,
});
Object.assign(Resolver, { Live: ResolverLayer });

const resolverOutcome = (
  outcome:
    | {
        readonly kind: "success";
        readonly customerId: string;
        readonly autoLinked?: boolean;
      }
    | {
        readonly kind: "failure";
        readonly reason: string;
        readonly linkReason?: string;
      }
) =>
  outcome.kind === "success"
    ? Effect.succeed({
        account: { accountId, dotyposCustomerId: outcome.customerId },
        autoLinked: outcome.autoLinked ?? false,
      })
    : Effect.fail({ reason: outcome.reason, linkReason: outcome.linkReason });

const Profile = Context.Service<
  Profile,
  {
    readonly load: () => Effect.Effect<
      {
        readonly firstName: string;
        readonly lastName: string | null;
        readonly phone: string | null;
        readonly billing: null;
      },
      unknown
    >;
  }
>()("@test/AccountProfile");

const profileLoadEffect = Effect.succeed({
  firstName: "Ada",
  lastName: "Lovelace",
  phone: null,
  billing: null,
});

const ProfileLayer = Layer.succeed(Profile, {
  load: () => {
    profileLoadCalls += 1;
    return profileLoadEffect;
  },
});
Object.assign(Profile, { Live: ProfileLayer });

let historyEffect: Effect.Effect<
  | {
      readonly kind: "available";
      readonly groups: {
        current: unknown[];
        past: unknown[];
        unavailable: unknown[];
      };
    }
  | { readonly kind: "unavailable"; readonly reason: string },
  unknown
>;

const History = Context.Service<
  History,
  { readonly load: () => typeof historyEffect }
>()("@test/AccountReservationHistory");

const HistoryLayer = Layer.succeed(History, {
  load: () => {
    historyLoadCalls += 1;
    return historyEffect;
  },
});
Object.assign(History, { Live: HistoryLayer });

mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({
    CustomerAuthentication: Authentication,
  })
);
mock.module(
  "@/features/account/backend/customer-account-resolver.service",
  () => ({
    resolveCurrentCustomerAccount: Effect.suspend(() => {
      resolverCalls += 1;
      return resolveEffect.pipe(
        Effect.ensuring(Effect.sync(() => events.push("resolved")))
      );
    }),
    CustomerAccountResolver: Resolver,
  })
);
mock.module("@/features/account/backend/customer-profile.service", () => ({
  CustomerProfileService: Profile,
}));
mock.module(
  "@/features/account/backend/customer-reservation-history.service",
  () => ({
    CustomerReservationHistoryService: History,
  })
);

let avatarLookupEffect: Effect.Effect<
  { readonly url: string; readonly version?: number } | null,
  unknown
>;

const Avatar = Context.Service<
  Avatar,
  {
    readonly lookup: (
      accountId: CustomerAccountId
    ) => typeof avatarLookupEffect;
  }
>()("@test/AccountAvatar");

const AvatarLayer = Layer.succeed(Avatar, {
  lookup: () => {
    avatarLookupCalls += 1;
    return avatarLookupEffect;
  },
});
Object.assign(Avatar, { Live: AvatarLayer });

mock.module("@/features/account/backend/customer-avatar.service", () => ({
  CustomerAvatarService: Avatar,
}));

const referralSummary = {
  code: "RFL12345",
  inviteeCount: 0,
  eligibleInviteeCount: 0,
  discount: "0",
  savings: [],
} as const;
let referralSummaryEffect: Effect.Effect<typeof referralSummary, unknown>;
let referralSummaryCalls: Array<{
  readonly customerAccountId: CustomerAccountId;
  readonly dotyposCustomerId: string;
}> = [];
let availableReferralCodeEffect: Effect.Effect<string | undefined, unknown>;
let availableReferralCodeCalls: Array<{ readonly code: unknown }> = [];
let acceptReferralEffect: Effect.Effect<unknown, { readonly reason: string }>;
let acceptReferralCalls: Array<{
  readonly code: unknown;
  readonly customerAccountId: CustomerAccountId;
  readonly dotyposCustomerId: string;
}> = [];
type TestReferralService = {
  readonly getAccountSummary: (input: {
    readonly customerAccountId: CustomerAccountId;
    readonly dotyposCustomerId: string;
  }) => typeof referralSummaryEffect;
  readonly findAvailableCode: (input: {
    readonly code: unknown;
  }) => typeof availableReferralCodeEffect;
  readonly acceptReferral: (
    input: (typeof acceptReferralCalls)[number]
  ) => typeof acceptReferralEffect;
};
const Referrals = Context.Service<Referrals, TestReferralService>()(
  "@test/AccountReferrals"
);
const ReferralsLayer = Layer.succeed(Referrals, {
  getAccountSummary: (input) => {
    referralSummaryCalls.push(input);
    events.push("summary");
    return referralSummaryEffect;
  },
  acceptReferral: (input) => {
    acceptReferralCalls.push(input);
    events.push("accept");
    return acceptReferralEffect;
  },
  findAvailableCode: (input) => {
    availableReferralCodeCalls.push(input);
    return availableReferralCodeEffect;
  },
});
Object.assign(Referrals, { Live: ReferralsLayer });
mock.module("@/features/referrals", () => ({ ReferralService: Referrals }));
mock.module("@/shared/backend/config/workspace-url.config", () => ({
  getWorkspaceRuntimeCallbackOrigin: Effect.succeed(
    new URL("https://workspace.example")
  ),
}));
const accountReferrals = {
  summary: referralSummary,
  shareUrl: "https://workspace.example/account?ref=RFL12345",
};

type StoredSignupIntent = {
  readonly code: string;
  readonly promotionCodeId: string;
  readonly referrerDotyposCustomerId: string;
};
let storedSignupIntent: StoredSignupIntent | undefined;
const SignupIntents = Context.Service<
  SignupIntents,
  {
    readonly find: (
      accountId: CustomerAccountId
    ) => Effect.Effect<StoredSignupIntent | undefined>;
    readonly remove: (
      accountId: CustomerAccountId,
      promotionCodeId: string
    ) => Effect.Effect<void>;
  }
>()("@test/AccountSignupIntents");
Object.assign(SignupIntents, {
  Live: Layer.succeed(SignupIntents, {
    find: () => Effect.sync(() => storedSignupIntent),
    remove: () =>
      Effect.sync(() => {
        storedSignupIntent = undefined;
      }),
  }),
});
mock.module("@/features/referrals/signup-intent.repository", () => ({
  ReferralSignupIntentRepository: SignupIntents,
}));

const areAccountAvatarsEnabled = mock(() => Promise.resolve(true));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountAvatarsEnabled,
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (_operation: string, _options: { readonly boundary: string }) =>
    (effect: Effect.Effect<unknown, unknown, never>) =>
      Effect.runPromise(effect),
}));

describe("loadCustomerAccountPage", () => {
  beforeEach(() => {
    currentUserEffect = Effect.succeed(activeSession);
    resolveEffect = resolverOutcome({ kind: "success", customerId: "60111" });
    resolverCalls = 0;
    profileLoadCalls = 0;
    historyLoadCalls = 0;
    avatarLookupCalls = 0;
    avatarLookupEffect = Effect.succeed(null);
    referralSummaryEffect = Effect.succeed(referralSummary);
    referralSummaryCalls = [];
    availableReferralCodeEffect = Effect.succeed("RFL12345");
    availableReferralCodeCalls = [];
    acceptReferralEffect = Effect.succeed({ status: "accepted" });
    acceptReferralCalls = [];
    storedSignupIntent = undefined;
    events = [];
    areAccountAvatarsEnabled.mockReset();
    areAccountAvatarsEnabled.mockResolvedValue(true);
    historyEffect = Effect.succeed({
      kind: "available",
      groups: { current: [], past: [], unavailable: [] },
    });
  });

  const loadPageState = async (referralCode?: string) => {
    const { loadCustomerAccountPage } = await import("./page-data.server");
    const { parseReferralCode } = await import("@/features/referrals/client");
    return loadCustomerAccountPage("en-US", parseReferralCode(referralCode));
  };

  test("returns unauthenticated without customer data or downstream work when no session exists", async () => {
    currentUserEffect = Effect.succeed(null);

    await expect(loadPageState()).resolves.toEqual({
      kind: "unauthenticated",
    });
    expect(resolverCalls).toBe(0);
    expect(profileLoadCalls).toBe(0);
    expect(historyLoadCalls).toBe(0);
  });

  test("returns unauthenticated without customer data when resolution reports no session", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unauthenticated",
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "unauthenticated",
    });
    expect(resolverCalls).toBe(1);
    expect(profileLoadCalls).toBe(0);
    expect(historyLoadCalls).toBe(0);
  });

  test("renders the unavailable state when the authoritative session read fails", async () => {
    currentUserEffect = Effect.fail(new Error("boom"));

    await expect(loadPageState()).resolves.toEqual({ kind: "unavailable" });
  });

  test("renders the completion state when no Dotypos profile matches", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "not-found",
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "completion-required",
      email: "ada@example.test",
    });
  });

  test("prefills a currently usable referral code on the completion state", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "not-found",
    });

    await expect(loadPageState("RFL12345")).resolves.toEqual({
      kind: "completion-required",
      email: "ada@example.test",
      referralCode: "RFL12345",
    });
    expect(availableReferralCodeCalls).toEqual([{ code: "RFL12345" }]);
  });

  test("silently leaves the completion referral empty when the code is not usable", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "not-found",
    });

    availableReferralCodeEffect = Effect.succeed(undefined);
    await expect(loadPageState("RFLGONE1")).resolves.toEqual({
      kind: "completion-required",
      email: "ada@example.test",
    });

    availableReferralCodeEffect = Effect.fail(new Error("database down"));
    await expect(loadPageState("RFL12345")).resolves.toEqual({
      kind: "completion-required",
      email: "ada@example.test",
    });
  });

  test("ignores a referral code once the account is linked", async () => {
    const state = await loadPageState("RFL12345");

    expect(state.kind).toBe("linked");
    expect(state).not.toHaveProperty("referralCode");
    expect(availableReferralCodeCalls).toEqual([]);
    expect(acceptReferralCalls).toEqual([]);
  });

  test("records the shared invitation after this sign-in linked an existing customer", async () => {
    resolveEffect = resolverOutcome({
      kind: "success",
      customerId: "60111",
      autoLinked: true,
    });

    const state = await loadPageState("RFL12345");

    expect(state).toMatchObject({
      kind: "linked",
      referrals: accountReferrals,
    });
    expect(acceptReferralCalls).toEqual([
      {
        code: "RFL12345",
        customerAccountId: accountId,
        dotyposCustomerId: "60111",
      },
    ]);
    expect(events).toEqual(["resolved", "accept", "summary"]);
  });

  test("retries the code a profile completion could not record yet, after resolution", async () => {
    storedSignupIntent = {
      code: "RFLPENDING",
      promotionCodeId: "@test/promotion-code-id",
      referrerDotyposCustomerId: "70001",
    };

    const state = await loadPageState();

    expect(state.kind).toBe("linked");
    expect(acceptReferralCalls).toEqual([
      {
        code: "RFLPENDING",
        customerAccountId: accountId,
        dotyposCustomerId: "60111",
      },
    ]);
    expect(events).toEqual(["resolved", "accept", "summary"]);
    expect(storedSignupIntent).toBeUndefined();
  });

  test("shows a stored code that settles as applied on that visit, and not on a fresh one", async () => {
    storedSignupIntent = {
      code: "RFLPENDING",
      promotionCodeId: "@test/promotion-code-id",
      referrerDotyposCustomerId: "70001",
    };
    acceptReferralEffect = Effect.fail({ reason: "pending_payment" });

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      signupReferral: { status: "pending" },
    });
    expect(storedSignupIntent).toBeDefined();

    acceptReferralEffect = Effect.succeed({ status: "accepted" });
    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      signupReferral: { status: "applied" },
    });
    expect(storedSignupIntent).toBeUndefined();

    const freshVisit = await loadPageState();
    expect(freshVisit.kind).toBe("linked");
    expect(freshVisit).not.toHaveProperty("signupReferral");
  });

  test("shows a stored code that settles as rejected once, after the first booking is paid", async () => {
    storedSignupIntent = {
      code: "RFLPENDING",
      promotionCodeId: "@test/promotion-code-id",
      referrerDotyposCustomerId: "70001",
    };
    acceptReferralEffect = Effect.fail({ reason: "ineligible" });

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      signupReferral: { status: "not-applied", reason: "not-eligible" },
    });
    expect(storedSignupIntent).toBeUndefined();

    const freshVisit = await loadPageState();
    expect(freshVisit).not.toHaveProperty("signupReferral");
    expect(acceptReferralCalls).toHaveLength(1);
  });

  test("leaves a stored code unsettled when the linked page cannot render", async () => {
    storedSignupIntent = {
      code: "RFLPENDING",
      promotionCodeId: "@test/promotion-code-id",
      referrerDotyposCustomerId: "70001",
    };
    Object.assign(Profile, {
      Live: Layer.succeed(Profile, {
        load: () => Effect.fail(new Error("provider down")),
      }),
    });
    try {
      await expect(loadPageState()).resolves.toMatchObject({
        kind: "authenticated-unavailable",
      });
      expect(acceptReferralCalls).toEqual([]);
      expect(storedSignupIntent).toBeDefined();
    } finally {
      Object.assign(Profile, { Live: ProfileLayer });
    }
  });

  test("records nothing when an auto-linked sign-in carries no shared code", async () => {
    resolveEffect = resolverOutcome({
      kind: "success",
      customerId: "60111",
      autoLinked: true,
    });

    await expect(loadPageState()).resolves.toMatchObject({ kind: "linked" });
    expect(acceptReferralCalls).toEqual([]);
  });

  test("keeps the linked page and logs only a fixed reason when the invitation is not recorded", async () => {
    resolveEffect = resolverOutcome({
      kind: "success",
      customerId: "60111",
      autoLinked: true,
    });
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(
        args
          .map((arg) => (Predicate.isString(arg) ? arg : JSON.stringify(arg)))
          .join(" ")
      );
    };
    const spies = [
      spyOn(console, "log").mockImplementation(capture),
      spyOn(console, "warn").mockImplementation(capture),
      spyOn(console, "error").mockImplementation(capture),
    ];

    try {
      for (const reason of [
        "unavailable",
        "self_referral",
        "ineligible",
        "already_attributed",
      ]) {
        acceptReferralEffect = Effect.fail({ reason });
        await expect(loadPageState("RFLSHARE")).resolves.toMatchObject({
          kind: "linked",
          profile: { firstName: "Ada" },
          referrals: accountReferrals,
        });
      }
      acceptReferralEffect = Effect.die(new Error("referral store down"));
      await expect(loadPageState("RFLSHARE")).resolves.toMatchObject({
        kind: "linked",
        referrals: accountReferrals,
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const output = lines.filter((line) => line.includes("WARN")).join("\n");
    expect(output).toContain("account.auto-link.referral");
    expect(output).toContain("self_referral");
    expect(output).toContain("ineligible");
    expect(output).toContain("already_attributed");
    expect(output).not.toContain("RFLSHARE");
    expect(output).not.toContain("referral store down");
  });

  test("renders the support state for ambiguous, unusable, claimed, and unverified outcomes", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "ambiguous",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "unusable",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "claimed",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unverified-email",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });
  });

  test("renders the retryable deletion state when the durable marker is set", async () => {
    currentUserEffect = Effect.succeed({
      ...activeSession,
      deletionRequested: true,
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "deletion-pending",
      email: "ada@example.test",
    });
  });

  test("renders the linked account with profile and grouped history", async () => {
    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      email: "ada@example.test",
      profile: { firstName: "Ada" },
      avatar: { kind: "available", avatar: null },
      history: { kind: "available" },
      referrals: accountReferrals,
    });
    expect(referralSummaryCalls).toEqual([
      { customerAccountId: accountId, dotyposCustomerId: "60111" },
    ]);
  });

  test("keeps the profile available and marks history unavailable when the provider fails", async () => {
    historyEffect = Effect.fail(new Error("dotypos down"));

    await expect(loadPageState()).resolves.toEqual({
      kind: "linked",
      email: "ada@example.test",
      profile: {
        firstName: "Ada",
        lastName: "Lovelace",
        phone: null,
        billing: null,
      },
      avatar: { kind: "available", avatar: null },
      history: { kind: "unavailable", reason: "provider-unavailable" },
      referrals: accountReferrals,
    });
  });

  test("logs fixed, cause-free warnings when history and avatar degrade", async () => {
    historyEffect = Effect.fail(new Error("dotypos down"));
    avatarLookupEffect = Effect.fail(new Error("cloudinary down"));
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(
        args
          .map((arg) => (Predicate.isString(arg) ? arg : JSON.stringify(arg)))
          .join(" ")
      );
    };
    const spies = [
      spyOn(console, "log").mockImplementation(capture),
      spyOn(console, "warn").mockImplementation(capture),
      spyOn(console, "error").mockImplementation(capture),
    ];

    try {
      await expect(loadPageState()).resolves.toMatchObject({
        kind: "linked",
        avatar: { kind: "available", avatar: null },
        history: { kind: "unavailable", reason: "provider-unavailable" },
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const output = lines.filter((line) => line.includes("WARN")).join("\n");
    expect(output).toContain("account.reservation-history.unavailable");
    expect(output).toContain("account.avatar.unavailable");
    expect(output).not.toContain("dotypos down");
    expect(output).not.toContain("cloudinary down");
  });

  test("includes the versioned avatar when the account has one", async () => {
    avatarLookupEffect = Effect.succeed({
      url: "https://res.cloudinary.test/avatar.webp",
      version: 1735689600,
    });

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      avatar: {
        kind: "available",
        avatar: {
          url: "https://res.cloudinary.test/avatar.webp",
          version: 1735689600,
        },
      },
    });
    expect(avatarLookupCalls).toBe(1);
  });

  test("falls back to no avatar when the avatar read fails", async () => {
    avatarLookupEffect = Effect.fail(new Error("media outage"));

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      avatar: { kind: "available", avatar: null },
    });
    expect(avatarLookupCalls).toBe(1);
  });

  test("keeps profile and history available while hiding avatars and skipping lookup when disabled", async () => {
    areAccountAvatarsEnabled.mockResolvedValue(false);

    await expect(loadPageState()).resolves.toEqual({
      kind: "linked",
      email: "ada@example.test",
      profile: {
        firstName: "Ada",
        lastName: "Lovelace",
        phone: null,
        billing: null,
      },
      avatar: { kind: "hidden" },
      history: {
        kind: "available",
        groups: { current: [], past: [], unavailable: [] },
      },
      referrals: accountReferrals,
    });
    expect(avatarLookupCalls).toBe(0);
    expect(profileLoadCalls).toBe(1);
    expect(historyLoadCalls).toBe(1);
  });

  test("fails closed without avatar lookup when avatar capability evaluation is unavailable", async () => {
    areAccountAvatarsEnabled.mockRejectedValue(new Error("flag unavailable"));

    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      avatar: { kind: "hidden" },
      profile: { firstName: "Ada" },
      history: { kind: "available" },
    });
    expect(avatarLookupCalls).toBe(0);
  });

  test("renders the authenticated unavailable state when the profile read fails after a successful link", async () => {
    const failingProfileLayer = Layer.succeed(Profile, {
      load: () => Effect.fail(new Error("profile gone")),
    });
    Object.assign(Profile, { Live: failingProfileLayer });

    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      email: "ada@example.test",
    });

    Object.assign(Profile, { Live: ProfileLayer });
  });

  test("renders the authenticated unavailable state for an unexpected resolver failure", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unexpected",
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      email: "ada@example.test",
    });
  });
});
