import { Option } from "effect";
import ExternalLink from "lucide-react-native/icons/external-link";
import User from "lucide-react-native/icons/user";
import UserPlus from "lucide-react-native/icons/user-plus";
import {
  type ComponentRef,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { vatIdFormatExample } from "../../account/profile/profile-fields";
import { CompanyLookup } from "../../company-lookup/company-lookup";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { CheckboxRow } from "../../ui/checkbox";
import { ChoiceList } from "../../ui/choice-list";
import { Button, TextField } from "../../ui/controls";
import { CountryField } from "../../ui/country-field";
import { FieldPair } from "../../ui/field-pair";
import { Icon } from "../../ui/icon";
import { Notice } from "../../ui/notice";
import { SegmentedChoice } from "../../ui/segmented-choice";
import { Text } from "../../ui/text";
import { color, radius, shadow, space, touchTarget } from "../../ui/tokens";
import { useKeyboardShown } from "../../ui/use-keyboard-shown";
import type {
  CheckoutDetails,
  DetailsNotice,
} from "../checkout/checkout-state";
import { BookingBar, type BookingBarSummary } from "../ui/booking-bar";
import { BookingSectionHeading } from "../ui/booking-section-heading";
import { BookingSteps } from "../ui/booking-steps";
import { retryMessage } from "./checkout-copy";
import {
  type AddressDraft,
  asksPersonalAddress,
  type BillingChoice,
  companyLookupFields,
  companyWithDetails,
  type DetailsChange,
  type DetailsDraft,
  type DetailsField,
  type DetailsFieldProblems,
  type DetailsProfile,
  detailsFieldOf,
  type FieldProblem,
  type InvoiceAddress,
  orderedProblems,
  problemsAfterChange,
  validateDetails,
  withRejectedSavedFields,
} from "./details-form";

type Locale = { readonly locale: AppLocale };

export interface DetailsStepProps extends Locale {
  readonly profile: DetailsProfile;
  /** The "Booking as" card: initials for its avatar; none without a name. */
  readonly initials: Option.Option<string>;
  /** Opens Account › Profile, where the name and phone are edited. */
  readonly onEditProfile: Option.Option<() => void>;
  readonly draft: DetailsDraft;
  readonly onDraftChange: (draft: DetailsDraft) => void;
  readonly notice: Option.Option<DetailsNotice>;
  /** The hold is being created: the form holds still, readable. */
  readonly busy: boolean;
  /** The booking bar's summary of the quoted selection. */
  readonly summary: BookingBarSummary;
  /**
   * The language the checkout is created in, whose marketing document the
   * server records a grant against: the consent sentence and its document
   * are shown in it.
   */
  readonly consentLocale: AppLocale;
  readonly onOpenMarketingDocument: () => void;
  readonly onContinue: (details: CheckoutDetails) => void;
  readonly onRetry: () => void;
  /** Gallery and captures: the problems a submit left. */
  readonly initialProblems?: DetailsFieldProblems;
  /** The height above the step, such as the stack header's. */
  readonly keyboardOffset?: number;
}

/**
 * Checkout step 2 (boards 30, 31): who the booking is for, the invoice and
 * the optional news consent, in one scroll view over the sticky booking
 * bar, whose Continue stays reachable above the keyboard. A submit with
 * problems marks each field, counts them by the button and brings the first
 * into view; typing or switching clears what no longer applies.
 */
export function DetailsStep(props: DetailsStepProps) {
  const {
    profile,
    draft,
    onDraftChange,
    notice,
    busy,
    summary,
    onContinue,
    onRetry,
    locale,
    initialProblems = {},
  } = props;
  const [problems, setProblems] =
    useState<DetailsFieldProblems>(initialProblems);
  const [raised, setRaised] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const fieldViews = useRef(
    new Map<DetailsField, ComponentRef<typeof View> | null>()
  );
  const [scrollTo, setScrollTo] = useState<{ field: DetailsField } | null>(
    null
  );
  const keyboardShown = useKeyboardShown();

  // A server refusal naming a field marks it as a submit's problem would.
  const serverField = notice.pipe(
    Option.flatMap((shown) =>
      shown._tag === "DetailsInvalid"
        ? detailsFieldOf(shown.field)
        : Option.none()
    )
  );
  const [rejectedSaved, setRejectedSaved] = useState<
    ReadonlySet<"name" | "phone">
  >(new Set());
  // Each refusal arrives as a new notice: taken in once, while rendering.
  const [seenNotice, setSeenNotice] = useState(notice);
  if (notice !== seenNotice) {
    setSeenNotice(notice);
    if (Option.isSome(serverField)) {
      const field = serverField.value;
      setProblems((current) => ({ ...current, [field]: "invalid" }));
      if (
        draft.bookingFor === "self" &&
        (field === "name" || field === "phone")
      )
        setRejectedSaved((current) => new Set([...current, field]));
      setScrollTo({ field });
    }
  }
  const self = withRejectedSavedFields(profile.self, rejectedSaved);

  useEffect(() => {
    if (scrollTo === null) return;
    const view = fieldViews.current.get(scrollTo.field);
    const content = scroll.current?.getInnerViewRef();
    if (view && content) {
      view.measureLayout(content, (_x, y) =>
        scroll.current?.scrollTo({ y: Math.max(0, y - space.lg) })
      );
    }
  }, [scrollTo]);

  const change = (next: DetailsDraft, what: DetailsChange) => {
    onDraftChange(next);
    setProblems((current) => problemsAfterChange(current, what));
  };
  const field = (name: DetailsField) => ({
    error: Option.match(Option.fromUndefinedOr(problems[name]), {
      onNone: () => undefined,
      onSome: (problem) => fieldProblemMessage(name, problem, locale),
    }),
    editable: !busy,
    viewRef: (view: ComponentRef<typeof View> | null) => {
      fieldViews.current.set(name, view);
    },
  });

  const submit = () => {
    const validation = validateDetails({ ...profile, self }, draft);
    if (validation._tag === "Invalid") {
      setProblems(validation.problems);
      const first = orderedProblems(validation.problems)[0];
      if (first !== undefined) setScrollTo({ field: first.field });
      return;
    }
    setProblems({});
    onContinue(validation.details);
  };

  const reason = barReason({
    busy,
    count: orderedProblems(problems).length,
    unplacedRefusal:
      Option.exists(notice, (shown) => shown._tag === "DetailsInvalid") &&
      Option.isNone(serverField),
    locale,
  });

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) =>
    setRaised(event.nativeEvent.contentOffset.y > 0);

  return (
    <KeyboardAvoidingView
      behavior="padding"
      // Without the header's height the keyboard covered Pay.
      keyboardVerticalOffset={props.keyboardOffset ?? 0}
      style={styles.screen}
    >
      <BookingSteps current="details" raised={raised} locale={locale} />
      <ScrollView
        ref={scroll}
        style={styles.body}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={32}
      >
        <BookingSectionHeading
          title={m.booking_details_who_heading({}, { locale })}
          first
        />
        <WhoChoice
          selected={draft.bookingFor}
          onSelect={(bookingFor) =>
            change({ ...draft, bookingFor }, { _tag: "BookingFor" })
          }
          disabled={busy}
          locale={locale}
        />
        {draft.bookingFor === "self" ? (
          <SelfSection {...props} self={self} change={change} field={field} />
        ) : (
          <SomeoneElseFields
            draft={draft}
            change={change}
            field={field}
            locale={locale}
          />
        )}
        <InvoiceSection
          draft={draft}
          saved={profile.saved}
          change={change}
          field={field}
          busy={busy}
          locale={locale}
        />
        {draft.bookingFor === "self" && (
          <MarketingSection
            checked={draft.marketingConsent}
            onChange={(marketingConsent) =>
              busy || onDraftChange({ ...draft, marketingConsent })
            }
            onOpenDocument={props.onOpenMarketingDocument}
            consentLocale={props.consentLocale}
          />
        )}
        <RetryNotice
          notice={notice}
          busy={busy}
          onRetry={onRetry}
          locale={locale}
        />
      </ScrollView>
      <BookingBar
        locale={locale}
        // With the keyboard up only the button rides above it (board 30).
        summary={keyboardShown ? undefined : summary}
        action={{
          label: busy
            ? m.booking_details_holding({}, { locale })
            : m.booking_details_continue({}, { locale }),
          onPress: submit,
          busy,
        }}
        reason={keyboardShown ? undefined : reason?.text}
        reasonTone={reason?.tone}
      />
    </KeyboardAvoidingView>
  );
}

type Change = (next: DetailsDraft, what: DetailsChange) => void;
type FieldPropsOf = (name: DetailsField) => {
  readonly error: string | undefined;
  readonly editable: boolean;
  readonly viewRef: (view: ComponentRef<typeof View> | null) => void;
};

/** "Me" or "Someone else". */
function WhoChoice({
  selected,
  onSelect,
  disabled,
  locale,
}: Locale & {
  readonly selected: DetailsDraft["bookingFor"];
  readonly onSelect: (bookingFor: DetailsDraft["bookingFor"]) => void;
  readonly disabled: boolean;
}) {
  return (
    <SegmentedChoice
      label={m.booking_details_who_heading({}, { locale })}
      options={[
        {
          value: "self",
          icon: User,
          label: m.booking_details_who_me({}, { locale }),
        },
        {
          value: "someone-else",
          icon: UserPlus,
          label: m.booking_details_who_someone_else({}, { locale }),
        },
      ]}
      selected={selected}
      onSelect={onSelect}
      disabled={disabled}
    />
  );
}

/**
 * "Booking as": the account's name, full login email and phone, as the
 * booking uses them. Edit opens the profile (a self booking always books
 * with the account's details, on the site too); a missing name or phone is
 * asked for here and saved to the profile with the booking.
 */
function SelfSection({
  self,
  initials,
  onEditProfile,
  draft,
  change,
  field,
  locale,
}: DetailsStepProps & {
  readonly self: DetailsProfile["self"];
  readonly change: Change;
  readonly field: FieldPropsOf;
}) {
  const setSelf = (patch: Partial<DetailsDraft["self"]>, name: DetailsField) =>
    change(
      { ...draft, self: { ...draft.self, ...patch } },
      {
        _tag: "Field",
        field: name,
      }
    );
  return (
    <>
      <BookingSectionHeading
        title={m.booking_checkout_booking_as({}, { locale })}
      />
      <View style={styles.card}>
        {Option.isSome(initials) && (
          <View style={styles.avatar} aria-hidden>
            <Text variant="bodyStrong" style={styles.avatarText}>
              {initials.value}
            </Text>
          </View>
        )}
        <View style={styles.cardText}>
          {(Option.isSome(self.name) || Option.isSome(onEditProfile)) && (
            <View style={styles.cardNameRow}>
              <Text variant="bodyStrong" style={styles.cardName}>
                {Option.getOrElse(self.name, () => "")}
              </Text>
              {Option.isSome(onEditProfile) && (
                <Pressable
                  role="button"
                  aria-label={m.booking_details_edit_profile_label(
                    {},
                    { locale }
                  )}
                  hitSlop={space.md}
                  onPress={onEditProfile.value}
                >
                  <Text variant="label" tone="action">
                    {m.booking_details_edit({}, { locale })}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
          <OneLineEmail email={self.email} />
          {Option.isSome(self.phone) && (
            <Text variant="bodySmall">{self.phone.value}</Text>
          )}
        </View>
      </View>
      {(Option.isNone(self.name) || Option.isNone(self.phone)) && (
        <View style={styles.selfFields}>
          <Text variant="bodySmall">
            {m.booking_checkout_profile_hint({}, { locale })}
          </Text>
          {Option.isNone(self.name) && (
            <Field
              {...field("name")}
              label={m.booking_checkout_field_name({}, { locale })}
              value={draft.self.name}
              onChangeText={(name) => setSelf({ name }, "name")}
              autoComplete="name"
              textContentType="name"
              autoCapitalize="words"
            />
          )}
          {Option.isNone(self.phone) && (
            <Field
              {...field("phone")}
              label={m.booking_checkout_field_phone({}, { locale })}
              value={draft.self.phone}
              onChangeText={(phone) => setSelf({ phone }, "phone")}
              autoComplete="tel"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
            />
          )}
        </View>
      )}
    </>
  );
}

/**
 * The login email whole, on one line (the owner's rule for addresses, so
 * where the booking goes reads at a glance): natively it shrinks to fit the
 * card; the web, which can't shrink text to fit, scrolls it sideways.
 */
function OneLineEmail({ email }: { readonly email: string }) {
  if (Platform.OS === "web") {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text variant="bodySmall" tone="default" numberOfLines={1}>
          {email}
        </Text>
      </ScrollView>
    );
  }
  return (
    <Text
      variant="bodySmall"
      tone="default"
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.5}
    >
      {email}
    </Text>
  );
}

/** Booking for someone else: their name, one email and phone. */
function SomeoneElseFields({
  draft,
  change,
  field,
  locale,
}: Locale & {
  readonly draft: DetailsDraft;
  readonly change: Change;
  readonly field: FieldPropsOf;
}) {
  const set = (
    patch: Partial<DetailsDraft["someoneElse"]>,
    name: DetailsField
  ) =>
    change(
      { ...draft, someoneElse: { ...draft.someoneElse, ...patch } },
      {
        _tag: "Field",
        field: name,
      }
    );
  return (
    <View style={[styles.fields, styles.someoneElse]}>
      <Field
        {...field("name")}
        label={m.booking_details_their_name({}, { locale })}
        value={draft.someoneElse.name}
        onChangeText={(name) => set({ name }, "name")}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
      />
      <Field
        {...field("email")}
        label={m.booking_details_their_email({}, { locale })}
        hint={m.booking_details_their_email_hint({}, { locale })}
        value={draft.someoneElse.email}
        onChangeText={(email) => set({ email }, "email")}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        {...field("phone")}
        label={m.booking_details_their_phone({}, { locale })}
        value={draft.someoneElse.phone}
        onChangeText={(phone) => set({ phone }, "phone")}
        placeholder="+420 600 000 000"
        autoComplete="tel"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
      />
    </View>
  );
}

const savedAddressText = (address: InvoiceAddress, locale: AppLocale) =>
  m.booking_details_saved_address(
    {
      street: address.line1,
      postalCode: address.postalCode,
      city: address.city,
    },
    { locale }
  );

/**
 * The invoice choice, and the fields the chosen invoice needs: "Invoice to
 * me" offers the saved address as it is (or asks for one), a company
 * invoice asks for the company and its address.
 */
function InvoiceSection({
  draft,
  saved,
  change,
  field,
  busy,
  locale,
}: Locale & {
  readonly draft: DetailsDraft;
  readonly saved: DetailsProfile["saved"];
  readonly change: Change;
  readonly field: FieldPropsOf;
  readonly busy: boolean;
}) {
  const choices: ReadonlyArray<{
    value: BillingChoice;
    label: string;
    description?: string;
  }> = [
    { value: "none", label: m.booking_details_invoice_none({}, { locale }) },
    {
      value: "personal-invoice",
      label: m.booking_details_invoice_me({}, { locale }),
      description: Option.match(saved.address, {
        onNone: () => m.booking_details_invoice_me_description({}, { locale }),
        onSome: (address) => savedAddressText(address, locale),
      }),
    },
    {
      value: "business",
      label: m.booking_details_invoice_company({}, { locale }),
      description: m.booking_details_invoice_company_description(
        {},
        { locale }
      ),
    },
  ];
  const company = draft.company;
  const setCompany = (
    patch: Partial<DetailsDraft["company"]>,
    name: DetailsField
  ) =>
    change(
      { ...draft, company: { ...company, ...patch } },
      {
        _tag: "Field",
        field: name,
      }
    );
  return (
    <>
      <BookingSectionHeading
        title={m.booking_details_invoice_heading({}, { locale })}
      />
      <ChoiceList
        label={m.booking_details_invoice_heading({}, { locale })}
        choices={choices}
        selected={draft.billing}
        // While the hold is made the cards stay as they were, readable,
        // and ignore presses (board 31: nothing turns muddy).
        onSelect={(billing) =>
          busy || change({ ...draft, billing }, { _tag: "Billing" })
        }
      />
      {draft.billing === "personal-invoice" && asksPersonalAddress(saved) && (
        <>
          <BookingSectionHeading
            title={m.booking_details_invoice_address_heading({}, { locale })}
          />
          <AddressFields
            address={draft.personalAddress}
            onChange={(personalAddress, name) =>
              change(
                { ...draft, personalAddress },
                { _tag: "Field", field: name }
              )
            }
            field={field}
            busy={busy}
            locale={locale}
          />
        </>
      )}
      {draft.billing === "business" && (
        <>
          <BookingSectionHeading
            title={m.booking_details_company_heading({}, { locale })}
          />
          <View style={styles.fields}>
            <Field
              {...field("buyer.legalName")}
              label={m.booking_details_company_name({}, { locale })}
              value={company.legalName}
              onChangeText={(legalName) =>
                setCompany({ legalName }, "buyer.legalName")
              }
              autoComplete="organization"
              autoCapitalize="words"
            />
            <View style={styles.companyIdLookup}>
              <Field
                {...field("buyer.companyId")}
                label={m.booking_details_company_id({}, { locale })}
                hint={m.booking_details_company_id_hint({}, { locale })}
                value={company.companyId}
                onChangeText={(companyId) =>
                  setCompany({ companyId }, "buyer.companyId")
                }
                keyboardType="number-pad"
              />
              <CompanyLookup
                companyId={company.companyId}
                fields={companyLookupFields.map((detail) => ({
                  field: detail,
                  label: companyLookupLabel[detail]({}, { locale }),
                }))}
                onApply={(details) => {
                  const applied = companyWithDetails(company, details);
                  change(
                    { ...draft, company: applied.company },
                    { _tag: "Fields", fields: applied.fields }
                  );
                }}
                disabled={busy}
                // Checkout has no Save button: applying shows no line.
                remindsToSave={false}
                locale={locale}
              />
            </View>
            <Field
              {...field("buyer.vatId")}
              label={m.booking_details_vat_id({}, { locale })}
              optional={m.booking_details_optional_field({}, { locale })}
              value={company.vatId}
              onChangeText={(vatId) => setCompany({ vatId }, "buyer.vatId")}
              placeholder={vatIdFormatExample}
              autoCapitalize="characters"
            />
            <AddressFields
              address={company.address}
              onChange={(address, name) =>
                change(
                  { ...draft, company: { ...company, address } },
                  {
                    _tag: "Field",
                    field: name,
                  }
                )
              }
              field={field}
              busy={busy}
              locale={locale}
            />
          </View>
        </>
      )}
    </>
  );
}

// The company form's own labels, which the lookup's review lists.
const companyLookupLabel = {
  companyName: m.booking_details_company_name,
  companyId: m.booking_details_company_id,
  vatId: m.booking_details_vat_id,
  addressLine1: m.booking_details_street,
  city: m.booking_details_city,
  zip: m.booking_details_postal_code,
  country: m.booking_details_country,
} as const satisfies Record<(typeof companyLookupFields)[number], unknown>;

/** Street, then city and postal code side by side, then the country picker. */
function AddressFields({
  address,
  onChange,
  field,
  busy,
  locale,
}: Locale & {
  readonly address: AddressDraft;
  readonly onChange: (address: AddressDraft, field: DetailsField) => void;
  readonly field: FieldPropsOf;
  readonly busy: boolean;
}) {
  const set = (patch: Partial<AddressDraft>, name: DetailsField) =>
    onChange({ ...address, ...patch }, name);
  const country = field("address.country");
  return (
    <View style={styles.fields}>
      <Field
        {...field("address.line1")}
        label={m.booking_details_street({}, { locale })}
        value={address.line1}
        onChangeText={(line1) => set({ line1 }, "address.line1")}
        autoComplete="address-line1"
        autoCapitalize="words"
      />
      <FieldPair
        wide={
          <Field
            {...field("address.city")}
            label={m.booking_details_city({}, { locale })}
            value={address.city}
            onChangeText={(city) => set({ city }, "address.city")}
            autoCapitalize="words"
          />
        }
        narrow={
          <Field
            {...field("address.postalCode")}
            label={m.booking_details_postal_code({}, { locale })}
            value={address.postalCode}
            onChangeText={(postalCode) =>
              set({ postalCode }, "address.postalCode")
            }
            autoComplete="postal-code"
          />
        }
      />
      <View ref={country.viewRef}>
        <CountryField
          label={m.booking_details_country({}, { locale })}
          value={address.country}
          onChange={(code) => set({ country: code }, "address.country")}
          error={country.error}
          disabled={busy}
          locale={locale}
        />
      </View>
    </View>
  );
}

/**
 * News from Deskohub: the brand's consent sentence and, next to it, the
 * Marketing Communications Consent document it grants under, both in the
 * checkout's language.
 */
function MarketingSection({
  checked,
  onChange,
  onOpenDocument,
  consentLocale,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly onOpenDocument: () => void;
  readonly consentLocale: AppLocale;
}) {
  const locale = consentLocale;
  return (
    <>
      <BookingSectionHeading
        title={m.booking_details_news_heading({}, { locale })}
        aside={m.booking_details_optional({}, { locale })}
      />
      <View style={styles.group}>
        <CheckboxRow
          label={m.booking_details_marketing_consent({}, { locale })}
          checked={checked}
          onChange={onChange}
        />
        {/* Under the sentence, on its text's edge, read as a link. */}
        <Pressable
          role="link"
          onPress={onOpenDocument}
          hitSlop={space.sm}
          style={({ pressed }) => [
            styles.documentLink,
            pressed && styles.documentLinkPressed,
          ]}
        >
          <Text variant="label" tone="action" style={styles.documentLinkText}>
            {m.legal_document_marketing({}, { locale })}
          </Text>
          <Icon icon={ExternalLink} size={16} color={color.action} />
        </Pressable>
      </View>
    </>
  );
}

function RetryNotice({
  notice,
  busy,
  onRetry,
  locale,
}: Locale & {
  readonly notice: Option.Option<DetailsNotice>;
  readonly busy: boolean;
  readonly onRetry: () => void;
}) {
  const shown = Option.getOrUndefined(notice);
  const retryable = shown?._tag === "Retryable" ? shown : undefined;
  return (
    <View style={retryable && styles.retry}>
      <Notice
        tone="error"
        message={retryable && retryMessage(retryable.kind, locale)}
      />
      {retryable !== undefined && (
        <Button
          label={m.booking_checkout_retry({}, { locale })}
          onPress={onRetry}
          disabled={busy}
          variant="secondary"
        />
      )}
    </View>
  );
}

/** A text field that the form can bring into view. */
function Field({
  viewRef,
  ...input
}: Parameters<typeof TextField>[0] & {
  readonly viewRef: (view: ComponentRef<typeof View> | null) => void;
}): ReactNode {
  return (
    <View ref={viewRef}>
      <TextField {...input} />
    </View>
  );
}

/** What to fix in a field, said at the field. */
export const fieldProblemMessage = (
  field: DetailsField,
  problem: FieldProblem,
  locale: AppLocale
): string => {
  switch (problem) {
    case "required":
    case "invalid_country":
      return requiredMessage(field, locale);
    case "too_short":
      return m.booking_checkout_field_too_short({}, { locale });
    case "too_long":
      return m.booking_checkout_field_too_long({}, { locale });
    case "invalid_email":
      return m.booking_checkout_field_invalid_email({}, { locale });
    case "invalid_phone":
      return m.booking_checkout_field_invalid_phone({}, { locale });
    case "invalid":
      return m.booking_checkout_field_invalid({}, { locale });
  }
};

const requiredMessage = (field: DetailsField, locale: AppLocale) =>
  ({
    name: () => m.booking_details_error_name({}, { locale }),
    email: () => m.booking_details_error_email({}, { locale }),
    phone: () => m.booking_details_error_phone({}, { locale }),
    "buyer.legalName": () =>
      m.booking_details_error_company_name({}, { locale }),
    "buyer.companyId": () => m.booking_details_error_company_id({}, { locale }),
    "buyer.vatId": () => m.booking_checkout_field_invalid({}, { locale }),
    "address.line1": () => m.booking_details_error_street({}, { locale }),
    "address.city": () => m.booking_details_error_city({}, { locale }),
    "address.postalCode": () =>
      m.booking_details_error_postal_code({}, { locale }),
    "address.country": () => m.booking_details_error_country({}, { locale }),
  })[field]();

/**
 * The line under Continue: the hold while it's being made, else how many
 * fields to fix, else a refusal the form can't place at a field.
 */
const barReason = ({
  busy,
  count,
  unplacedRefusal,
  locale,
}: Locale & {
  readonly busy: boolean;
  readonly count: number;
  readonly unplacedRefusal: boolean;
}): { text: string; tone: "plain" | "error" } | undefined => {
  if (busy)
    return { text: m.booking_details_hold_note({}, { locale }), tone: "plain" };
  if (count > 0)
    return { text: fixFieldsMessage(count, locale), tone: "error" };
  if (unplacedRefusal)
    return {
      text: m.booking_checkout_details_invalid({}, { locale }),
      tone: "error",
    };
  return undefined;
};

/** "Fix 2 fields to continue"; one is its own message. */
const fixFieldsMessage = (count: number, locale: AppLocale) =>
  count === 1
    ? m.booking_details_fix_one_field({}, { locale })
    : m.booking_details_fix_fields({ count }, { locale });

const styles = StyleSheet.create({
  screen: { backgroundColor: color.paper, flex: 1 },
  body: { flex: 1 },
  content: {
    alignSelf: "center",
    maxWidth: 640,
    paddingBottom: space.xxl,
    paddingHorizontal: space.gutter,
    paddingTop: space.xs,
    width: "100%",
  },
  fields: { gap: space.lg },
  // The lookup sits right under the Company ID field it reads (board 30b).
  companyIdLookup: { gap: space.sm },
  card: {
    ...shadow.group,
    alignItems: "flex-start",
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 1,
    flexDirection: "row",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: color.navy,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  avatarText: { color: color.white, letterSpacing: 0.5 },
  cardText: { flex: 1, minWidth: 0 },
  cardNameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    justifyContent: "space-between",
  },
  cardName: { flexShrink: 1 },
  group: {
    backgroundColor: color.surface,
    borderColor: color.line,
    borderRadius: radius.group,
    borderWidth: 1,
    paddingBottom: space.sm,
    paddingHorizontal: space.md,
  },
  documentLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.xs,
    minHeight: touchTarget,
    paddingLeft: 38,
  },
  documentLinkPressed: { opacity: 0.6 },
  documentLinkText: { flexShrink: 1 },
  selfFields: { gap: space.lg, paddingTop: space.md },
  someoneElse: { paddingTop: space.xl },
  retry: { gap: space.md, paddingTop: space.xl },
});
