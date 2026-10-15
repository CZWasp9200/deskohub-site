"use client";

import type {
  AudienceAttributeOfKind,
  AudienceConditionOf,
} from "@deskohub/workspace-admin-api";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { type Locale, locales } from "@/features/i18n";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
  ConditionLine,
  ConditionText,
  type ControlProps,
  CountComparisonControl,
  compactInputClassName,
  compactSelectClassName,
  FieldError,
  type FieldErrorLookup,
  numberFromInput,
  numberInputValue,
  SetOperatorSelect,
  ValueChips,
  withPath,
} from "./audience-control-primitives";
import {
  type DatePeriodKind,
  isDatePeriodUnit,
  type ReservationStatus,
  switchDatePeriod,
  toggleSetValue,
} from "./audience-filter-editing";
import { ProductFilterControl } from "./reservation-product-filter-control";

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
