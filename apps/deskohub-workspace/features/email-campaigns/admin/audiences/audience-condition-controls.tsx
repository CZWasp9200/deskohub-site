"use client";

import type {
  AudienceAttributeOfKind,
  AudienceConditionOf,
  AudienceCountOperatorType,
  ReservationProductFilterType,
  ReservationProductPropertyCondition,
} from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import { ChevronDown, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type Locale, locales } from "@/features/i18n";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import {
  type ReservationProductProperty,
  reservationProductFamilies,
  reservationProductProperty,
} from "@/features/reservation/reservation-product-descriptor";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/components/ui/toggle-group";
import { cn } from "@/shared/utils";
import type { DatePeriod } from "../../date-period";
import type { DiscountGroupOption } from "../audience-filter-summary";
import { datePeriodUnitNames } from "../date-period-phrases";
import {
  type DatePeriodKind,
  isDatePeriodUnit,
  type ReservationStatus,
  switchDatePeriod,
  toggleSetValue,
} from "./audience-filter-editing";

const compactSelectClassName = "min-h-9 w-auto rounded-md px-3 py-1.5 text-sm";
const compactInputClassName = "h-9 min-h-9 rounded-md px-3 py-1.5 text-sm";

/** Error message for a field path relative to the control, if any. */
export type FieldErrorLookup = (field: string) => string | undefined;

type ControlProps<Value> = {
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  readonly errorAt: FieldErrorLookup;
};

export function FieldError({ message }: { readonly message: string }) {
  return (
    <p role="alert" className="text-burned-orange text-sm">
      {message}
    </p>
  );
}

/** Wording kept apart from the controls so the row reads as a sentence. */
function ConditionText({ children }: { readonly children: ReactNode }) {
  return <span className="text-sm">{children}</span>;
}

/** One line of a condition sentence; it wraps on narrow screens. */
function ConditionLine({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {children}
    </div>
  );
}

const countOperators: Readonly<
  Record<
    AudienceCountOperatorType,
    { readonly symbol: string; readonly name: string }
  >
> = {
  eq: { symbol: "=", name: "equals" },
  ne: { symbol: "≠", name: "is not" },
  lt: { symbol: "<", name: "less than" },
  lte: { symbol: "≤", name: "at most" },
  gt: { symbol: ">", name: "more than" },
  gte: { symbol: "≥", name: "at least" },
};

const isCountOperator = (value: string): value is AudienceCountOperatorType =>
  Object.hasOwn(countOperators, value);

/** Parses a number field; an empty or partial entry stays invalid for the schema. */
const numberFromInput = (raw: string) =>
  raw.trim() === "" ? Number.NaN : Number(raw);

const numberInputValue = (value: number) =>
  Number.isNaN(value) ? "" : String(value);

/** An operator and a non-negative whole number: "≥ 2", "= 0". */
function CountComparisonControl({
  operator,
  value,
  onChange,
  errorAt,
  label,
}: {
  readonly operator: AudienceCountOperatorType;
  readonly value: number;
  readonly onChange: (comparison: {
    readonly operator: AudienceCountOperatorType;
    readonly value: number;
  }) => void;
  readonly errorAt: FieldErrorLookup;
  /** What is counted, for screen readers ("Reservation count"). */
  readonly label: string;
}) {
  const invalid = errorAt("value") !== undefined;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Select
        value={operator}
        onValueChange={(next) => {
          if (isCountOperator(next)) onChange({ operator: next, value });
        }}
      >
        <SelectTrigger
          aria-label={`${label} comparison`}
          className={cn(compactSelectClassName, "min-w-16 font-semibold")}
        >
          <SelectValue>{countOperators[operator].symbol}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(countOperators).map(([key, { symbol, name }]) => (
            <SelectItem key={key} value={key}>
              <span className="inline-block w-5 font-semibold">{symbol}</span>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={numberInputValue(value)}
        onChange={(event) =>
          onChange({ operator, value: numberFromInput(event.target.value) })
        }
        aria-label={label}
        aria-invalid={invalid}
        variant={invalid ? "error" : "default"}
        className={cn(compactInputClassName, "w-20")}
      />
    </span>
  );
}

const datePeriodKinds: Readonly<Record<DatePeriodKind, string>> = {
  AnyTime: "any time",
  Last: "in the last",
  Range: "from … to …",
  Since: "since",
  Onward: "from … onward",
  Until: "until",
};

const isDatePeriodKind = (value: string): value is DatePeriodKind =>
  Object.hasOwn(datePeriodKinds, value);

const today = () => getCurrentWorkspaceDate().toString();

/**
 * Any time, the last N days/weeks/months/years, from–to, since, or until. The
 * same control picks every period an audience condition uses.
 */
function DatePeriodControl({
  value,
  onChange,
  errorAt,
  label,
}: ControlProps<DatePeriod> & {
  /** What the period applies to, for screen readers. */
  readonly label: string;
}) {
  const dateInput = (
    date: string,
    field: string,
    fieldLabel: string,
    update: (date: string) => DatePeriod,
    bounds: { readonly min?: string; readonly max?: string } = {}
  ) => (
    <Input
      type="date"
      value={date}
      {...bounds}
      onChange={(event) => onChange(update(event.target.value))}
      aria-label={`${label} ${fieldLabel}`}
      variant={errorAt(field) || errorAt("") ? "error" : "default"}
      className={cn(compactInputClassName, "w-40 max-w-full")}
    />
  );

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Select
        value={value._tag}
        onValueChange={(kind) => {
          if (isDatePeriodKind(kind)) {
            onChange(switchDatePeriod(value, kind, today()));
          }
        }}
      >
        <SelectTrigger
          aria-label={`${label} period`}
          className={compactSelectClassName}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(datePeriodKinds).map(([kind, kindLabel]) => (
            <SelectItem key={kind} value={kind}>
              {kindLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value._tag === "Last" && (
        <span className="inline-flex items-center gap-1.5">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={numberInputValue(value.count)}
            onChange={(event) =>
              onChange({
                ...value,
                count: numberFromInput(event.target.value),
              })
            }
            aria-label={`${label} number of ${datePeriodUnitNames[value.unit].other}`}
            variant={errorAt("count") ? "error" : "default"}
            className={cn(compactInputClassName, "w-20")}
          />
          <Select
            value={value.unit}
            onValueChange={(unit) => {
              if (isDatePeriodUnit(unit)) onChange({ ...value, unit });
            }}
          >
            <SelectTrigger
              aria-label={`${label} period unit`}
              className={compactSelectClassName}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(datePeriodUnitNames).map(([unit, names]) => (
                <SelectItem key={unit} value={unit}>
                  {value.count === 1 ? names.one : names.other}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
      )}
      {value._tag === "Range" && (
        <>
          {dateInput(
            value.from,
            "from",
            "start date",
            (from) => ({ ...value, from }),
            { max: value.to }
          )}
          <ConditionText>to</ConditionText>
          {dateInput(value.to, "to", "end date", (to) => ({ ...value, to }), {
            min: value.from,
          })}
        </>
      )}
      {(value._tag === "Since" ||
        value._tag === "Onward" ||
        value._tag === "Until") &&
        dateInput(value.date, "date", "date", (date) => ({ ...value, date }))}
      {value._tag === "Onward" && <ConditionText>onward</ConditionText>}
    </span>
  );
}

/** Plain instructions for a period's invalid fields. */
const datePeriodErrors = (errorAt: FieldErrorLookup) =>
  [
    errorAt("count") && "Enter a whole number of 1 or more.",
    (errorAt("from") || errorAt("to") || errorAt("date")) &&
      "Enter a valid date.",
    errorAt("") && "The start date must be on or before the end date.",
  ].filter((message): message is string => Boolean(message));

const reservationStatusLabels: Readonly<Record<ReservationStatus, string>> = {
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
  needs_refund: "Needs refund",
};
const anyBookedStatus = "booked";
const isReservationStatus = (value: string): value is ReservationStatus =>
  Object.hasOwn(reservationStatusLabels, value);

const withPath =
  (errorAt: FieldErrorLookup, prefix: string): FieldErrorLookup =>
  (field) =>
    errorAt(field === "" ? prefix : `${prefix}.${field}`);

export function ReservationCountControls({
  value: condition,
  onChange,
  errorAt,
}: ControlProps<AudienceConditionOf<"reservationCount">>) {
  const { params } = condition;
  const periodErrorAt = withPath(errorAt, "params.period");
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>Number of</ConditionText>
        <Select
          value={params.status ?? anyBookedStatus}
          onValueChange={(next) => {
            const { status: _, ...rest } = params;
            onChange({
              ...condition,
              params: isReservationStatus(next)
                ? { ...rest, status: next }
                : rest,
            });
          }}
        >
          <SelectTrigger
            aria-label="Reservation status"
            className={compactSelectClassName}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* Without a status only booked reservations count. */}
            <SelectItem value={anyBookedStatus}>booked</SelectItem>
            {Object.entries(reservationStatusLabels).map(([status, label]) => (
              <SelectItem key={status} value={status}>
                {label.toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ConditionText>reservations by</ConditionText>
        <ToggleGroup
          type="single"
          value={params.dateBasis}
          onValueChange={(dateBasis) => {
            if (dateBasis === "visit" || dateBasis === "booking") {
              onChange({ ...condition, params: { ...params, dateBasis } });
            }
          }}
          aria-label="Date basis"
          className="whitespace-nowrap rounded-md border border-navy-blue/15 p-0.5"
        >
          <ToggleGroupItem value="visit">visit date</ToggleGroupItem>
          <ToggleGroupItem value="booking">booking date</ToggleGroupItem>
        </ToggleGroup>
      </ConditionLine>
      <ProductFilterControl
        value={params.product}
        onChange={(product) => {
          const { product: _, ...rest } = params;
          onChange({
            ...condition,
            params: product ? { ...rest, product } : rest,
          });
        }}
        errorAt={withPath(errorAt, "params.product")}
      />
      <ConditionLine>
        <DatePeriodControl
          value={params.period}
          onChange={(period) =>
            onChange({ ...condition, params: { ...params, period } })
          }
          errorAt={periodErrorAt}
          label="Reservations"
        />
        <ConditionText>is</ConditionText>
        <CountComparisonControl
          operator={condition.operator}
          value={condition.value}
          onChange={(comparison) => onChange({ ...condition, ...comparison })}
          errorAt={errorAt}
          label="Reservation count"
        />
      </ConditionLine>
      {[...datePeriodErrors(periodErrorAt), countError(errorAt)].map(
        (message) => message && <FieldError key={message} message={message} />
      )}
    </div>
  );
}

const countError = (errorAt: FieldErrorLookup) =>
  errorAt("value") && "Enter a whole number, 0 or more.";

const campaignPurposes = {
  marketing: "Marketing",
  operational: "Operational",
  any: "Any",
} as const;

const isCampaignEmailPurpose = (
  value: string
): value is keyof typeof campaignPurposes =>
  Object.hasOwn(campaignPurposes, value);

export function CampaignEmailCountControls({
  value: condition,
  onChange,
  errorAt,
}: ControlProps<AudienceConditionOf<"campaignEmailCount">>) {
  const { params } = condition;
  const periodErrorAt = withPath(errorAt, "params.period");
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>Number of</ConditionText>
        <Select
          value={params.purpose}
          onValueChange={(purpose) => {
            if (isCampaignEmailPurpose(purpose)) {
              onChange({ ...condition, params: { ...params, purpose } });
            }
          }}
        >
          <SelectTrigger
            aria-label="Campaign purpose"
            className={compactSelectClassName}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(campaignPurposes).map(([purpose, label]) => (
              <SelectItem key={purpose} value={purpose}>
                {label.toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ConditionText>campaign emails received</ConditionText>
      </ConditionLine>
      <ConditionLine>
        <DatePeriodControl
          value={params.period}
          onChange={(period) =>
            onChange({ ...condition, params: { ...params, period } })
          }
          errorAt={periodErrorAt}
          label="Emails received"
        />
        <ConditionText>is</ConditionText>
        <CountComparisonControl
          operator={condition.operator}
          value={condition.value}
          onChange={(comparison) => onChange({ ...condition, ...comparison })}
          errorAt={errorAt}
          label="Campaign email count"
        />
      </ConditionLine>
      {[...datePeriodErrors(periodErrorAt), countError(errorAt)].map(
        (message) => message && <FieldError key={message} message={message} />
      )}
    </div>
  );
}

type DateCondition = AudienceConditionOf<AudienceAttributeOfKind<"date">>;

const dateOperatorKeys = ["in", "notIn", "none"] as const;

/**
 * "is in <period>", "is not in <period>" (a value exists outside it), or the
 * attribute's own wording for no value ("never visited").
 */
export function DateConditionControls<Condition extends DateCondition>({
  value: condition,
  onChange,
  errorAt,
  label,
  noValueLabel,
}: ControlProps<Condition> & {
  readonly label: string;
  readonly noValueLabel: string;
}) {
  const period =
    condition.operator === "none"
      ? ({ _tag: "Last", count: 30, unit: "day" } as const)
      : condition.value;
  const operatorLabels = {
    in: "is",
    notIn: "is not",
    none: noValueLabel,
  } as const;
  const periodErrorAt = withPath(errorAt, "value");
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>{label}</ConditionText>
        <Select
          value={condition.operator}
          onValueChange={(operator) => {
            // Attribute parameters, such as a last visit's product, stay.
            const params = "params" in condition &&
              condition.params && { params: condition.params };
            if (operator === "none") {
              onChange({
                _tag: "Condition",
                attribute: condition.attribute,
                ...params,
                operator,
              } as Condition);
            } else if (operator === "in" || operator === "notIn") {
              onChange({
                _tag: "Condition",
                attribute: condition.attribute,
                ...params,
                operator,
                value: period,
              } as Condition);
            }
          }}
        >
          <SelectTrigger
            aria-label={`${label} condition`}
            className={compactSelectClassName}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dateOperatorKeys.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {operatorLabels[operator]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {condition.operator !== "none" && (
          <DatePeriodControl
            value={condition.value}
            onChange={(value) => onChange({ ...condition, value })}
            errorAt={periodErrorAt}
            label={label}
          />
        )}
      </ConditionLine>
      {datePeriodErrors(periodErrorAt).map((message) => (
        <FieldError key={message} message={message} />
      ))}
    </div>
  );
}

const setOperatorLabels = {
  anyOf: "is any of",
  allOf: "includes all of",
  noneOf: "is none of",
} as const;

function SetOperatorSelect<Operator extends keyof typeof setOperatorLabels>({
  operators,
  value,
  onChange,
  label,
}: {
  readonly operators: readonly Operator[];
  readonly value: Operator;
  readonly onChange: (operator: Operator) => void;
  readonly label: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const operator = operators.find((candidate) => candidate === next);
        if (operator) onChange(operator);
      }}
    >
      <SelectTrigger
        aria-label={`${label} match`}
        className={compactSelectClassName}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {operators.map((operator) => (
          <SelectItem key={operator} value={operator}>
            {setOperatorLabels[operator]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const localeLabels: Readonly<Record<Locale, string>> = {
  "cs-CZ": "Czech (cs-CZ)",
  "en-US": "English (en-US)",
};

export function LocaleControls({
  value: condition,
  onChange,
  errorAt,
  path,
}: ControlProps<AudienceConditionOf<"locale">> & { readonly path: string }) {
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>Locale</ConditionText>
        <SetOperatorSelect
          operators={["anyOf", "noneOf"]}
          value={condition.operator}
          onChange={(operator) => onChange({ ...condition, operator })}
          label="Locale"
        />
        {locales.map((locale) => {
          const checked = condition.value.includes(locale);
          const id = `${path}.value.${locale}`;
          return (
            <label
              key={locale}
              htmlFor={id}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(next) =>
                  onChange({
                    ...condition,
                    value: toggleSetValue(
                      condition.value,
                      locale,
                      next === true
                    ),
                  })
                }
                className="size-5"
              />
              {localeLabels[locale]}
            </label>
          );
        })}
      </ConditionLine>
      {errorAt("value") && <FieldError message="Choose at least one locale." />}
    </div>
  );
}

/** Chosen values as removable chips. */
function ValueChips({
  values,
  labelOf,
  onRemove,
  noun,
}: {
  readonly values: readonly string[];
  readonly labelOf: (value: string) => string;
  readonly onRemove: (value: string) => void;
  readonly noun: string;
}) {
  return values.map((value) => (
    <span
      key={value}
      className="inline-flex h-8 items-center gap-1 rounded-full border border-navy-blue/20 bg-navy-blue/[0.04] pr-1 pl-3 text-sm"
    >
      {labelOf(value)}
      <button
        type="button"
        onClick={() => onRemove(value)}
        aria-label={`Remove ${noun} ${labelOf(value)}`}
        className="flex h-6 w-6 items-center justify-center rounded-full text-navy-blue/55 hover:bg-navy-blue/10 hover:text-navy-blue"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  ));
}

/** Free-text values: type one and press Enter or a comma to add it. */
function ValueEntry({
  values,
  onChange,
  noun,
  placeholder,
  invalid,
}: {
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  readonly noun: string;
  readonly placeholder: string;
  readonly invalid: boolean;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const value = draft.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setDraft("");
  };
  return (
    <>
      <ValueChips
        values={values}
        labelOf={(value) => value}
        onRemove={(value) => onChange(values.filter((v) => v !== value))}
        noun={noun}
      />
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        aria-label={`Add ${noun}`}
        variant={invalid ? "error" : "default"}
        className={cn(compactInputClassName, "w-44 max-w-full")}
      />
    </>
  );
}

export function DotyposTagControls({
  value: condition,
  onChange,
  errorAt,
}: ControlProps<AudienceConditionOf<"dotyposTags">>) {
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>Tags</ConditionText>
        <SetOperatorSelect
          operators={["anyOf", "allOf", "noneOf"]}
          value={condition.operator}
          onChange={(operator) => onChange({ ...condition, operator })}
          label="Dotypos tags"
        />
        <ValueEntry
          values={condition.value}
          onChange={(values) => onChange({ ...condition, value: values })}
          noun="tag"
          placeholder="Add a tag"
          invalid={errorAt("value") !== undefined}
        />
      </ConditionLine>
      {errorAt("value") && <FieldError message="Add at least one tag." />}
    </div>
  );
}

export function DiscountGroupControls({
  value: condition,
  onChange,
  errorAt,
  discountGroups,
}: ControlProps<AudienceConditionOf<"discountGroup">> & {
  /** Dotypos discount groups to pick from; omitted means free ID entry. */
  readonly discountGroups: readonly DiscountGroupOption[] | undefined;
}) {
  const invalid = errorAt("value") !== undefined;
  const nameOf = (id: string) =>
    discountGroups?.find((group) => group.id === id)?.name ??
    `Unknown group ${id}`;
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>Discount group</ConditionText>
        <SetOperatorSelect
          operators={["anyOf", "noneOf"]}
          value={condition.operator}
          onChange={(operator) => onChange({ ...condition, operator })}
          label="Discount group"
        />
        {discountGroups ? (
          <>
            <ValueChips
              values={condition.value}
              labelOf={nameOf}
              onRemove={(id) =>
                onChange({
                  ...condition,
                  value: toggleSetValue(condition.value, id, false),
                })
              }
              noun="discount group"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-invalid={invalid}
                  className={cn(invalid && "border-burned-orange")}
                >
                  Choose groups
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {discountGroups.map((group) => (
                  <DropdownMenuCheckboxItem
                    key={group.id}
                    checked={condition.value.includes(group.id)}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...condition,
                        value: toggleSetValue(
                          condition.value,
                          group.id,
                          checked
                        ),
                      })
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    {group.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <ValueEntry
            values={condition.value}
            onChange={(values) => onChange({ ...condition, value: values })}
            noun="discount group ID"
            placeholder="Dotypos group ID"
            invalid={invalid}
          />
        )}
      </ConditionLine>
      {invalid && <FieldError message="Choose at least one discount group." />}
    </div>
  );
}

export function HasAccountControls({
  value: condition,
  onChange,
}: ControlProps<AudienceConditionOf<"hasAccount">>) {
  return (
    <ConditionLine>
      <ToggleGroup
        type="single"
        value={condition.value ? "has" : "hasNot"}
        onValueChange={(next) => {
          if (next === "has" || next === "hasNot") {
            onChange({ ...condition, value: next === "has" });
          }
        }}
        aria-label="Workspace account"
        className="whitespace-nowrap rounded-md border border-navy-blue/15 p-0.5"
      >
        <ToggleGroupItem value="has">Has</ToggleGroupItem>
        <ToggleGroupItem value="hasNot">Hasn&rsquo;t</ToggleGroupItem>
      </ToggleGroup>
      <ConditionText>a Workspace account</ConditionText>
    </ConditionLine>
  );
}

const anyProduct = "any";

const isReservationFamily = (
  value: string
): value is WorkspaceReservationKind =>
  Object.hasOwn(reservationProductFamilies, value);

/** What a property condition starts as when the operator adds it. */
const newPropertyCondition = (
  property: ReservationProductProperty
): ReservationProductPropertyCondition =>
  Match.value(property).pipe(
    Match.discriminatorsExhaustive("kind")({
      enum: ({ id }) => ({
        property: id,
        operator: "anyOf" as const,
        value: [],
      }),
      boolean: ({ id }) => ({
        property: id,
        operator: "is" as const,
        value: true,
      }),
      number: ({ id }) => ({
        property: id,
        operator: "gte" as const,
        value: 1,
      }),
    })
  );

/**
 * Narrows a reservation-based condition to one product family and, within
 * it, to catalog property conditions. The families, properties, and values
 * all come from the reservation product descriptor.
 */
export function ProductFilterControl({
  value,
  onChange,
  errorAt,
}: ControlProps<ReservationProductFilterType | undefined>) {
  const family = value && reservationProductFamilies[value.family];
  const unused =
    family?.properties.filter(
      ({ id }) => !value?.properties.some(({ property }) => property === id)
    ) ?? [];
  const setProperties = (
    properties: readonly ReservationProductPropertyCondition[]
  ) => value && onChange({ ...value, properties });

  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>Product</ConditionText>
        <Select
          value={value?.family ?? anyProduct}
          onValueChange={(next) =>
            onChange(
              isReservationFamily(next)
                ? { family: next, properties: [] }
                : undefined
            )
          }
        >
          <SelectTrigger
            aria-label="Reservation product"
            className={compactSelectClassName}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={anyProduct}>any product</SelectItem>
            {Object.values(reservationProductFamilies).map(({ id, label }) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value && unused.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm">
                <Plus className="h-4 w-4" aria-hidden />
                Add product condition
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {unused.map((property) => (
                <DropdownMenuItem
                  key={property.id}
                  onSelect={() =>
                    setProperties([
                      ...value.properties,
                      newPropertyCondition(property),
                    ])
                  }
                >
                  {property.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ConditionLine>
      {value?.properties.map((condition, index) => {
        const property = reservationProductProperty(
          value.family,
          condition.property
        );
        const conditionErrorAt = withPath(errorAt, `properties.${index}`);
        const replace = (next: ReservationProductPropertyCondition) =>
          setProperties(
            value.properties.map((current, i) => (i === index ? next : current))
          );
        return (
          <div
            key={condition.property}
            className="ml-3 flex flex-wrap items-center gap-x-2 gap-y-2 border-navy-blue/15 border-l-2 pl-3"
          >
            <ConditionText>
              {property?.label ?? condition.property}
            </ConditionText>
            {property && (
              <ProductPropertyControl
                property={property}
                value={condition}
                onChange={replace}
                errorAt={conditionErrorAt}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                setProperties(value.properties.filter((_, i) => i !== index))
              }
              aria-label={`Remove ${property?.label ?? condition.property} condition`}
              className="h-8 w-8 text-navy-blue/55 hover:text-navy-blue"
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
            {conditionErrorAt("value") && (
              <FieldError message="Choose at least one value." />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProductPropertyControl({
  property,
  value,
  onChange,
  errorAt,
}: ControlProps<ReservationProductPropertyCondition> & {
  readonly property: ReservationProductProperty;
}) {
  return Match.value(property).pipe(
    Match.discriminatorsExhaustive("kind")({
      enum: ({ label, values }) => {
        const chosen =
          value.operator === "anyOf" || value.operator === "noneOf"
            ? value.value
            : [];
        const operator = value.operator === "noneOf" ? "noneOf" : "anyOf";
        const nameOf = (id: string) => {
          const option = values.find((candidate) => candidate.id === id);
          return option ? option.name("en-US") : id;
        };
        return (
          <>
            <SetOperatorSelect
              operators={["anyOf", "noneOf"]}
              value={operator}
              onChange={(next) =>
                onChange({
                  property: property.id,
                  operator: next,
                  value: chosen,
                })
              }
              label={label}
            />
            <ValueChips
              values={chosen}
              labelOf={nameOf}
              onRemove={(id) =>
                onChange({
                  property: property.id,
                  operator,
                  value: toggleSetValue(chosen, id, false),
                })
              }
              noun={label.toLowerCase()}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-invalid={errorAt("value") !== undefined}
                  className={cn(
                    errorAt("value") !== undefined && "border-burned-orange"
                  )}
                >
                  Choose
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {values.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.id}
                    checked={chosen.includes(option.id)}
                    onCheckedChange={(checked) =>
                      onChange({
                        property: property.id,
                        operator,
                        value: toggleSetValue(chosen, option.id, checked),
                      })
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    {option.name("en-US")}
                    {option.retired && (
                      <span className="text-navy-blue/55">(retired)</span>
                    )}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        );
      },
      boolean: ({ label }) => (
        <ToggleGroup
          type="single"
          value={value.operator === "is" && !value.value ? "without" : "with"}
          onValueChange={(next) => {
            if (next === "with" || next === "without") {
              onChange({
                property: property.id,
                operator: "is",
                value: next === "with",
              });
            }
          }}
          aria-label={label}
          className="whitespace-nowrap rounded-md border border-navy-blue/15 p-0.5"
        >
          <ToggleGroupItem value="with">with</ToggleGroupItem>
          <ToggleGroupItem value="without">without</ToggleGroupItem>
        </ToggleGroup>
      ),
      number: ({ label }) => (
        <CountComparisonControl
          operator={
            value.operator === "anyOf" ||
            value.operator === "noneOf" ||
            value.operator === "is"
              ? "gte"
              : value.operator
          }
          value={typeof value.value === "number" ? value.value : Number.NaN}
          onChange={(comparison) =>
            onChange({ property: property.id, ...comparison })
          }
          errorAt={errorAt}
          label={label}
        />
      ),
    })
  );
}
