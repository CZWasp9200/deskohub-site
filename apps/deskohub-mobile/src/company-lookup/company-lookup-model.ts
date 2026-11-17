import type {
  CustomerCompanyDetails,
  CustomerCompanyIdInvalid,
  CustomerCompanyNotFound,
  CustomerCompanyRegistryUnavailable,
} from "@deskohub/workspace-customer-api";
import { Cause, Data, Exit, Match, Option } from "effect";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  isRetryableViewError,
  toCustomerViewError,
} from "../customer-api/customer-view-error";
import { sharedViewErrorMessage } from "../customer-api/customer-view-error-message";
import type { AppLocale } from "../i18n/app-locale";
import { m } from "../i18n/messages";

// The company lookup by IČO under a form's Company ID field (boards 07b, 13b
// and 30b), as the website's account billing lookup behaves: the registry's
// details wait for review and change the form only when applied.

/** A detail the registry can return, named as the profile's billing fields. */
export type CompanyDetailsField = keyof CustomerCompanyDetails;

/** Every way a lookup request can fail. */
export type CompanyLookupFailure =
  | CustomerCompanyIdInvalid
  | CustomerCompanyNotFound
  | CustomerCompanyRegistryUnavailable
  | CustomerRequestFailure;

/** Why a lookup found nothing to apply. */
export type CompanyLookupRefusal = Data.TaggedEnum<{
  /** Not a company ID, or nothing typed (then the registry isn't asked). */
  InvalidId: Record<never, never>;
  NotFound: Record<never, never>;
  /** The registry didn't answer; trying again can help. */
  RegistryUnavailable: Record<never, never>;
  /** The request itself failed: no connection, the rate limit, the account. */
  RequestFailed: { readonly error: CustomerViewError };
}>;
export const CompanyLookupRefusal = Data.taggedEnum<CompanyLookupRefusal>();

/**
 * Where the lookup for the typed company ID stands. Each state past `Idle`
 * names the ID it belongs to: once the field holds another, it is idle again.
 */
export type CompanyLookupState = Data.TaggedEnum<{
  Idle: Record<never, never>;
  LookingUp: { readonly companyId: string };
  /** The registry's details, waiting for Apply or Dismiss. */
  Found: {
    readonly companyId: string;
    readonly company: CustomerCompanyDetails;
  };
  /** The found details are in the form, as if typed. */
  Applied: { readonly companyId: string };
  Refused: {
    readonly companyId: string;
    readonly refusal: CompanyLookupRefusal;
  };
}>;
export const CompanyLookupState = Data.taggedEnum<CompanyLookupState>();

/**
 * The state a press of the lookup button starts from what the field holds:
 * a lookup of the trimmed ID, or, with nothing typed, the invalid-ID refusal
 * without asking the registry. The format itself is the server's to judge.
 */
export const lookupStarted = (typed: string): CompanyLookupState => {
  const companyId = typed.trim();
  return companyId === ""
    ? CompanyLookupState.Refused({
        companyId,
        refusal: CompanyLookupRefusal.InvalidId(),
      })
    : CompanyLookupState.LookingUp({ companyId });
};

const refusalOf = (failure: CompanyLookupFailure): CompanyLookupRefusal => {
  switch (failure._tag) {
    case "CustomerCompanyIdInvalid":
      return CompanyLookupRefusal.InvalidId();
    case "CustomerCompanyNotFound":
      return CompanyLookupRefusal.NotFound();
    case "CustomerCompanyRegistryUnavailable":
      return CompanyLookupRefusal.RegistryUnavailable();
    default:
      return CompanyLookupRefusal.RequestFailed({
        error: toCustomerViewError(failure),
      });
  }
};

/** The state a finished lookup of `companyId` leaves. */
export const lookupSettled = (
  companyId: string,
  exit: Exit.Exit<CustomerCompanyDetails, CompanyLookupFailure>
): CompanyLookupState =>
  Exit.isSuccess(exit)
    ? CompanyLookupState.Found({ companyId, company: exit.value })
    : CompanyLookupState.Refused({
        companyId,
        refusal: Option.match(Cause.findErrorOption(exit.cause), {
          onNone: () =>
            CompanyLookupRefusal.RequestFailed({
              error: CustomerViewError.Unexpected(),
            }),
          onSome: refusalOf,
        }),
      });

/**
 * The details Apply puts into a form that has `fields`: each one the registry
 * returned, and nothing else, so a value it lacks keeps what was typed.
 */
export const appliedDetails = (
  company: CustomerCompanyDetails,
  fields: ReadonlyArray<CompanyDetailsField>
): Partial<CustomerCompanyDetails> =>
  Object.fromEntries(
    fields.flatMap((field) => {
      const value = company[field];
      return value === undefined ? [] : [[field, value] as const];
    })
  );

/** The state Apply leaves: the lookup belongs to the ID now in the form. */
export const lookupApplied = (
  found: {
    readonly companyId: string;
    readonly company: CustomerCompanyDetails;
  },
  fields: ReadonlyArray<CompanyDetailsField>
): CompanyLookupState =>
  CompanyLookupState.Applied({
    companyId:
      fields.includes("companyId") && found.company.companyId !== undefined
        ? found.company.companyId
        : found.companyId,
  });

/**
 * The state once the field holds `typed`: an edit to another ID drops the
 * lookup, its result and any answer still on its way, as the website's
 * lookup does; typing the old ID back needs a new lookup.
 */
export const lookupAfterEdit = (
  state: CompanyLookupState,
  typed: string
): CompanyLookupState =>
  state._tag === "Idle" || state.companyId === typed.trim()
    ? state
    : CompanyLookupState.Idle();

/** What the lookup's button offers. */
export type LookupAction = "look-up" | "retry";

/** Try again once nothing was found or the failure may pass; else Look up. */
export const lookupAction = (state: CompanyLookupState): LookupAction =>
  state._tag === "Refused" &&
  Match.value(state.refusal).pipe(
    Match.tagsExhaustive({
      InvalidId: () => false,
      NotFound: () => true,
      RegistryUnavailable: () => true,
      RequestFailed: ({ error }) => isRetryableViewError(error),
    })
  )
    ? "retry"
    : "look-up";

/** The line under the button: an outcome, affirmative or an error. */
export interface LookupStatus {
  readonly tone: "positive" | "danger";
  readonly message: string;
}

const refusalMessage = (refusal: CompanyLookupRefusal, locale: AppLocale) =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      InvalidId: () => m.company_lookup_invalid_id({}, { locale }),
      NotFound: () => m.company_lookup_not_found({}, { locale }),
      RegistryUnavailable: () =>
        m.company_lookup_registry_unavailable({}, { locale }),
      RequestFailed: ({ error }) =>
        sharedViewErrorMessage(error, locale) ??
        m.account_error_unexpected({}, { locale }),
    })
  );

/**
 * The status line for `state`. Applied says to press Save only on a form
 * that has a Save button (`remindsToSave`); elsewhere it shows none.
 */
export const lookupStatus = (
  state: CompanyLookupState,
  {
    remindsToSave,
    locale,
  }: { readonly remindsToSave: boolean; readonly locale: AppLocale }
): LookupStatus | undefined =>
  Match.value(state).pipe(
    Match.tagsExhaustive({
      Idle: () => undefined,
      LookingUp: () => undefined,
      Found: (): LookupStatus => ({
        tone: "positive",
        message: m.company_lookup_found({}, { locale }),
      }),
      Applied: (): LookupStatus | undefined =>
        remindsToSave
          ? {
              tone: "positive",
              message: m.company_lookup_applied({}, { locale }),
            }
          : undefined,
      Refused: ({ refusal }): LookupStatus => ({
        tone: "danger",
        message: refusalMessage(refusal, locale),
      }),
    })
  );
