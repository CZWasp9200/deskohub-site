"use client";

import type { AudienceCountOperatorType } from "@deskohub/workspace-admin-api";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/utils";

export const compactSelectClassName =
  "min-h-9 w-auto rounded-md px-3 py-1.5 text-sm";
export const compactInputClassName =
  "h-9 min-h-9 rounded-md px-3 py-1.5 text-sm";

/** Error message for a field path relative to the control, if any. */
export type FieldErrorLookup = (field: string) => string | undefined;

export type ControlProps<Value> = {
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
export function ConditionText({ children }: { readonly children: ReactNode }) {
  return <span className="text-sm">{children}</span>;
}

/** One line of a condition sentence; it wraps on narrow screens. */
export function ConditionLine({ children }: { readonly children: ReactNode }) {
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
export const numberFromInput = (raw: string) =>
  raw.trim() === "" ? Number.NaN : Number(raw);

export const numberInputValue = (value: number) =>
  Number.isNaN(value) ? "" : String(value);

/**
 * What is wrong with a comparison: an always-true or never-true operator,
 * which the schema explains, or a value that isn't a whole number.
 */
export const countComparisonError = (errorAt: FieldErrorLookup) =>
  errorAt("operator") ??
  (errorAt("value") && "Enter a whole number, 0 or more.");

/** An operator and a non-negative whole number: "≥ 2", "= 0". */
export function CountComparisonControl({
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
          aria-invalid={errorAt("operator") !== undefined}
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

export const withPath =
  (errorAt: FieldErrorLookup, prefix: string): FieldErrorLookup =>
  (field) =>
    errorAt(field === "" ? prefix : `${prefix}.${field}`);

export const setOperatorLabels = {
  anyOf: "is any of",
  allOf: "includes all of",
  noneOf: "is none of",
} as const;

export function SetOperatorSelect<
  Operator extends keyof typeof setOperatorLabels,
>({
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

/** Chosen values as removable chips. */
export function ValueChips({
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
