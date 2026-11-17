import type {
  CustomerAccountState,
  CustomerProfile,
} from "@deskohub/workspace-customer-api";
import {
  type AccountRelease,
  type AccountSection,
  accountIndexModel,
} from "./account-gating";

/**
 * The PostHog flag that shows the Payment methods row. No such flag exists
 * yet, so the row stays off everywhere until saved cards (issue #412) ship
 * and decide their real release; an unknown or unloaded flag reads as off.
 * The screen reads it; the model only takes `AccountRelease`.
 */
export const paymentMethodsFeatureFlag = "saved_payment_methods";

/** Initials for an account without a photo, from the saved name. */
export const initialsOf = (profile: CustomerProfile) =>
  [profile.firstName, profile.lastName ?? ""]
    .map((name) => name.trim().charAt(0).toLocaleUpperCase())
    .join("");

/** Who is signed in, as the Account tab's masthead shows it. */
export interface AccountIdentity {
  readonly email: string;
  /** The profile's name; absent until the profile exists. */
  readonly name?: string;
  readonly initials?: string;
  readonly photoUrl?: string;
}

/**
 * What a row's second line says about the section's current state, as data:
 * the screen words it.
 */
export type AccountRowSubtitle =
  | { readonly kind: "language" }
  | { readonly kind: "security"; readonly passkeys: number }
  | { readonly kind: "assistants"; readonly connected: number }
  | {
      readonly kind: "billing";
      readonly invoicing: "none" | "personal" | "business";
    }
  /** Nobody counts toward the discount yet: what each invite earns. */
  | { readonly kind: "referral-offer"; readonly discountPerInvitee: string }
  /** The discount the invited friends currently earn. */
  | { readonly kind: "referral-earned"; readonly discount: string }
  | { readonly kind: "legal" };

/** A row the Account tab links from. */
export type AccountRowSection = Exclude<AccountSection, "complete">;

export interface AccountRow {
  readonly section: AccountRowSection;
  readonly subtitle?: AccountRowSubtitle;
}

/** The headings of the Account tab's groups after the first. */
export type AccountGroupHeading =
  | "your-account"
  | "rewards"
  | "privacy"
  | "danger";

export interface AccountGroup {
  /** Absent on the first group, which sits on the masthead. */
  readonly heading?: AccountGroupHeading;
  readonly rows: ReadonlyArray<AccountRow>;
}

export interface AccountRootModel {
  readonly identity: AccountIdentity;
  /** The account needs a profile first: the card that leads to it. */
  readonly completionCard: boolean;
  readonly groups: ReadonlyArray<AccountGroup>;
}

const identityOf = (account: CustomerAccountState): AccountIdentity => {
  if (account.kind !== "linked") return { email: account.email };
  const photo =
    account.avatar.kind === "available" ? account.avatar.avatar : null;
  return {
    email: account.email,
    name: [account.profile.firstName, account.profile.lastName ?? ""]
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(" "),
    initials: initialsOf(account.profile),
    ...(photo !== null && { photoUrl: photo.url }),
  };
};

const subtitleOf = (
  section: AccountRowSection,
  account: CustomerAccountState,
  firstGroupedWithLegal: boolean
): AccountRowSubtitle | undefined => {
  switch (section) {
    case "language":
      return { kind: "language" };
    case "security": {
      // Without the list (the read failed), the row claims nothing about it.
      const passkeys = account.passkeys?.passkeys;
      return passkeys == null
        ? undefined
        : { kind: "security", passkeys: passkeys.length };
    }
    case "assistants":
      return account.assistants == null
        ? undefined
        : { kind: "assistants", connected: account.assistants.length };
    case "billing":
      return account.kind === "linked"
        ? {
            kind: "billing",
            invoicing: account.profile.billing?.kind ?? "none",
          }
        : undefined;
    case "referrals": {
      if (account.kind !== "linked" || account.referrals === undefined)
        return undefined;
      const { summary, discountPerInvitee } = account.referrals;
      if (summary.eligibleInviteeCount > 0)
        return { kind: "referral-earned", discount: summary.discount };
      // An older Workspace doesn't say the rate; the row then claims none.
      return discountPerInvitee === undefined
        ? undefined
        : { kind: "referral-offer", discountPerInvitee };
    }
    case "legal":
      // Marketing emails need a profile, so before it the row names no part.
      return firstGroupedWithLegal ? undefined : { kind: "legal" };
    case "profile":
    case "payment-methods":
    case "invoices":
    case "danger":
      return undefined;
  }
};

/**
 * What the Account tab shows for a GET /account result, in the approved
 * order: the account's sections under the masthead, then Rewards, Privacy
 * and the Danger zone. Before the profile exists a card leads to it, and
 * the reachable sections follow under "Your account". Which sections show
 * is `accountIndexModel`'s gating for the app's releases.
 */
export const accountRootModel = (
  account: CustomerAccountState,
  release?: AccountRelease
): AccountRootModel => {
  const sections = accountIndexModel(account, release).sections.filter(
    (section): section is AccountRowSection => section !== "complete"
  );
  const completionCard = account.kind === "completion-required";
  const inFirst = (section: AccountRowSection) =>
    section !== "referrals" &&
    section !== "danger" &&
    (completionCard || section !== "legal");
  const row = (section: AccountRowSection): AccountRow => {
    const subtitle = subtitleOf(section, account, completionCard);
    return subtitle === undefined ? { section } : { section, subtitle };
  };
  const rowsWhere = (keep: (section: AccountRowSection) => boolean) =>
    sections.filter(keep).map(row);
  const groups: ReadonlyArray<AccountGroup> = [
    completionCard
      ? { heading: "your-account", rows: rowsWhere(inFirst) }
      : { rows: rowsWhere(inFirst) },
    { heading: "rewards", rows: rowsWhere((s) => s === "referrals") },
    {
      heading: "privacy",
      rows: rowsWhere((s) => s === "legal" && !completionCard),
    },
    { heading: "danger", rows: rowsWhere((s) => s === "danger") },
  ];
  return {
    identity: identityOf(account),
    completionCard,
    groups: groups.filter((group) => group.rows.length > 0),
  };
};
