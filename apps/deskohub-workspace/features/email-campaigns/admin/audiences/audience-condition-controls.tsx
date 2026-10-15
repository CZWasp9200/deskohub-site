"use client";

import type {
  AudienceBooleanAttributeDefinition,
  AudienceBooleanCondition,
  AudienceChoiceParam,
  AudienceCountAttributeDefinition,
  AudienceCountCondition,
  AudienceDateAttributeDefinition,
  AudienceDateCondition,
  AudienceSetAttributeDefinition,
  AudienceSetCondition,
} from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
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
import type {
  AudienceValueLookups,
  AudienceValueOption,
} from "../audience-filter-summary";
import { datePeriodUnitNames } from "../date-period-phrases";
import {
  ConditionLine,
  ConditionText,
  type ControlProps,
  CountComparisonControl,
  compactInputClassName,
  compactSelectClassName,
  countComparisonError,
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

/** A choice parameter's value; an optional one can be unset. */
function ChoiceParamControl({
  param,
  value,
  onChange,
}: {
  readonly param: AudienceChoiceParam;
  readonly value: unknown;
  readonly onChange: (value: string | undefined) => void;
}) {
  const options = Object.entries(param.options);
  const chosen = Object.keys(param.options).find((option) => option === value);
  const pick = (next: string) => {
    if (next === absentValue && param.absent) onChange(undefined);
    else if (Object.hasOwn(param.options, next)) onChange(next);
  };
  return Match.value(param.control).pipe(
    Match.when("toggle", () => (
      <ToggleGroup
        type="single"
        value={chosen ?? ""}
        onValueChange={pick}
        aria-label={param.label}
        className="whitespace-nowrap rounded-md border border-navy-blue/15 p-0.5"
      >
        {options.map(([option, { label }]) => (
          <ToggleGroupItem key={option} value={option}>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    )),
    Match.when("select", () => (
      <Select value={chosen ?? absentValue} onValueChange={pick}>
        <SelectTrigger
          aria-label={param.label}
          className={compactSelectClassName}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {param.absent && (
            <SelectItem value={absentValue}>{param.absent.label}</SelectItem>
          )}
          {options.map(([option, { label }]) => (
            <SelectItem key={option} value={option}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )),
    Match.exhaustive
  );
}

/** The select value standing for an unset optional choice. */
const absentValue = "absent";

/**
 * "Number of <lead>", the reservation product for reservation-based
 * attributes, then "<period> is <comparison>". Every count attribute edits
 * through it, worded by its catalogue entry.
 */
export function CountConditionControls<
  Condition extends AudienceCountCondition,
>({
  entry,
  value: condition,
  onChange,
  errorAt,
}: ControlProps<Condition> & {
  readonly entry: AudienceCountAttributeDefinition;
}) {
  const { params } = condition;
  const changeParams = (next: AudienceCountCondition["params"]) =>
    // The entry's params keep the condition's own shape.
    onChange({ ...condition, params: next } as Condition);
  const periodErrorAt = withPath(errorAt, "params.period");
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>Number of</ConditionText>
        {entry.editor.lead.map((token) => {
          if ("text" in token) {
            return <ConditionText key={token.text}>{token.text}</ConditionText>;
          }
          const param = entry.params[token.param];
          return (
            param?.part === "choice" && (
              <ChoiceParamControl
                key={token.param}
                param={param}
                value={params[token.param]}
                onChange={(value) => {
                  const { [token.param]: _, ...rest } = params;
                  changeParams(
                    value === undefined
                      ? { ...rest, period: params.period }
                      : { ...params, [token.param]: value }
                  );
                }}
              />
            )
          );
        })}
      </ConditionLine>
      {entry.reservationProduct && (
        <ProductFilterControl
          value={params.product}
          onChange={(product) => {
            const { product: _, ...rest } = params;
            changeParams(product ? { ...rest, product } : rest);
          }}
          errorAt={withPath(errorAt, "params.product")}
        />
      )}
      <ConditionLine>
        <DatePeriodControl
          value={params.period}
          onChange={(period) => changeParams({ ...params, period })}
          errorAt={periodErrorAt}
          label={entry.editor.period}
        />
        <ConditionText>is</ConditionText>
        <CountComparisonControl
          operator={condition.operator}
          value={condition.value}
          onChange={(comparison) => onChange({ ...condition, ...comparison })}
          errorAt={errorAt}
          label={entry.editor.count}
        />
      </ConditionLine>
      {[...datePeriodErrors(periodErrorAt), countComparisonError(errorAt)].map(
        (message) => message && <FieldError key={message} message={message} />
      )}
    </div>
  );
}

const dateOperatorKeys = ["in", "notIn", "none"] as const;

/**
 * "is in <period>", "is not in <period>" (a value exists outside it), or the
 * attribute's own wording for no value ("never visited"), then the
 * reservation product for reservation-based attributes.
 */
export function DateConditionControls<Condition extends AudienceDateCondition>({
  entry: { label, editor, reservationProduct },
  value: condition,
  onChange,
  errorAt,
}: ControlProps<Condition> & {
  readonly entry: AudienceDateAttributeDefinition;
}) {
  const period =
    condition.operator === "none"
      ? ({ _tag: "Last", count: 30, unit: "day" } as const)
      : condition.value;
  const operatorLabels = {
    in: "is",
    notIn: "is not",
    none: editor.noValue,
  } as const;
  const periodErrorAt = withPath(errorAt, "value");
  // Attribute parameters, such as a last visit's product, stay.
  const params = condition.params && { params: condition.params };
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>{label}</ConditionText>
        <Select
          value={condition.operator}
          onValueChange={(operator) => {
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
      {reservationProduct && (
        <ProductFilterControl
          value={condition.params?.product}
          onChange={(product) => {
            const { params: _, ...rest } = condition;
            onChange(
              (product ? { ...rest, params: { product } } : rest) as Condition
            );
          }}
          errorAt={withPath(errorAt, "params.product")}
        />
      )}
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

/** Looked-up values to pick from, shown as chips. */
function LookupPicker({
  values,
  onChange,
  options,
  noun,
  choose,
  invalid,
}: {
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  readonly options: readonly AudienceValueOption[];
  readonly noun: string;
  readonly choose: string;
  readonly invalid: boolean;
}) {
  const nameOf = (id: string) =>
    options.find((option) => option.id === id)?.name ?? `Unknown ${noun} ${id}`;
  return (
    <>
      <ValueChips
        values={values}
        labelOf={nameOf}
        onRemove={(id) => onChange(toggleSetValue(values, id, false))}
        noun={noun}
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
            {choose}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={values.includes(option.id)}
              onCheckedChange={(checked) =>
                onChange(toggleSetValue(values, option.id, checked))
              }
              onSelect={(event) => event.preventDefault()}
            >
              {option.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * "<lead> <match> <values>": checkboxes for fixed options, chips with a
 * picker for looked-up values, or chips with free-text entry.
 */
export function SetConditionControls<Condition extends AudienceSetCondition>({
  entry,
  value: condition,
  onChange,
  errorAt,
  path,
  lookups,
}: ControlProps<Condition> & {
  readonly entry: AudienceSetAttributeDefinition;
  /** Form path of the condition, for checkbox IDs. */
  readonly path: string;
  readonly lookups: AudienceValueLookups;
}) {
  const invalid = errorAt("value") !== undefined;
  const setValues = (value: readonly string[]) =>
    onChange({ ...condition, value });
  const freeText = (noun: string, placeholder: string) => (
    <ValueEntry
      values={condition.value}
      onChange={setValues}
      noun={noun}
      placeholder={placeholder}
      invalid={invalid}
    />
  );
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>{entry.editor.lead}</ConditionText>
        <SetOperatorSelect
          operators={entry.operators}
          value={condition.operator}
          onChange={(operator) => onChange({ ...condition, operator })}
          label={entry.label}
        />
        {Match.value(entry.values).pipe(
          Match.tagsExhaustive({
            Options: ({ options }) =>
              Object.entries(options).map(([option, { label }]) => {
                const id = `${path}.value.${option}`;
                return (
                  <label
                    key={option}
                    htmlFor={id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={id}
                      checked={condition.value.includes(option)}
                      onCheckedChange={(next) =>
                        setValues(
                          toggleSetValue(condition.value, option, next === true)
                        )
                      }
                      className="size-5"
                    />
                    {label}
                  </label>
                );
              }),
            FreeText: ({ noun, placeholder }) => freeText(noun, placeholder),
            Lookup: ({ lookup, noun, choose, freeText: fallback }) => {
              const options = lookups[lookup];
              return options ? (
                <LookupPicker
                  values={condition.value}
                  onChange={setValues}
                  options={options}
                  noun={noun}
                  choose={choose}
                  invalid={invalid}
                />
              ) : (
                freeText(fallback.noun, fallback.placeholder)
              );
            },
          })
        )}
      </ConditionLine>
      {invalid && (
        <FieldError
          message={`${entry.values._tag === "FreeText" ? "Add" : "Choose"} at least one ${entry.values.noun}.`}
        />
      )}
    </div>
  );
}

/** "<true or false> <object>", as in "Has a Workspace account". */
export function BooleanConditionControls<
  Condition extends AudienceBooleanCondition,
>({
  entry,
  value: condition,
  onChange,
}: ControlProps<Condition> & {
  readonly entry: AudienceBooleanAttributeDefinition;
}) {
  return (
    <ConditionLine>
      <ToggleGroup
        type="single"
        value={String(condition.value)}
        onValueChange={(next) => {
          if (next === "true" || next === "false") {
            onChange({ ...condition, value: next === "true" });
          }
        }}
        aria-label={entry.label}
        className="whitespace-nowrap rounded-md border border-navy-blue/15 p-0.5"
      >
        <ToggleGroupItem value="true">{entry.editor.true}</ToggleGroupItem>
        <ToggleGroupItem value="false">{entry.editor.false}</ToggleGroupItem>
      </ToggleGroup>
      <ConditionText>{entry.editor.object}</ConditionText>
    </ConditionLine>
  );
}
