"use client";

import { Match } from "effect";
import { ChevronDown, ListPlus, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { type Locale, locales } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  DropdownMenu,
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
import type { AudienceFilter } from "../../audience-filter";

export type AudienceFilterGroup = Extract<AudienceFilter, { _tag: "Group" }>;
type AudienceCondition = Exclude<AudienceFilter, { _tag: "Group" }>;
type ReservationCondition = Extract<AudienceFilter, { _tag: "Reservation" }>;
type ReservationStatus = NonNullable<ReservationCondition["status"]>;

export type DiscountGroupOption = {
  readonly id: string;
  readonly name: string;
};

/** Error message React Hook Form holds for a form path, if any. */
export type FilterErrorLookup = (path: string) => string | undefined;

/** The builder always edits a group, so a bare stored condition gets an AND root. */
export const asRootGroup = (filter: AudienceFilter): AudienceFilterGroup =>
  filter._tag === "Group"
    ? filter
    : { _tag: "Group", operator: "and", filters: [filter] };

const newConditions = {
  Reservation: {
    label: "Reservation history",
    create: (): AudienceCondition => ({
      _tag: "Reservation",
      presence: "has",
      dateBasis: "visit",
    }),
  },
  Locale: {
    label: "Locale",
    create: (): AudienceCondition => ({ _tag: "Locale", locales: ["cs-CZ"] }),
  },
  DotyposTag: {
    label: "Dotypos tag",
    create: (): AudienceCondition => ({ _tag: "DotyposTag", tag: "" }),
  },
  DiscountGroup: {
    label: "Discount group",
    create: (): AudienceCondition => ({
      _tag: "DiscountGroup",
      discountGroupId: "",
    }),
  },
  Account: {
    label: "Workspace account",
    create: (): AudienceCondition => ({ _tag: "Account", hasAccount: true }),
  },
} satisfies Record<
  AudienceCondition["_tag"],
  { label: string; create: () => AudienceCondition }
>;

const operatorLabels = {
  and: { match: "Match all", joiner: "and" },
  or: { match: "Match any", joiner: "or" },
} as const;

const localeLabels: Readonly<Record<Locale, string>> = {
  "cs-CZ": "Czech (cs-CZ)",
  "en-US": "English (en-US)",
};

const reservationStatusLabels: Readonly<Record<ReservationStatus, string>> = {
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
  needs_refund: "Needs refund",
};
const anyReservationStatus = "any";
const isReservationStatus = (value: string): value is ReservationStatus =>
  Object.hasOwn(reservationStatusLabels, value);

const compactSelectClassName = "min-h-9 w-auto rounded-md px-3 py-1.5 text-sm";
const compactInputClassName = "h-9 rounded-md px-3 py-1.5 text-sm";

/** Nested groups alternate their accent so each level stands apart. */
const groupFrameClassName = (depth: number) => {
  if (depth === 0) return "border-navy-blue/15 bg-white";
  return depth % 2 === 1
    ? "border-navy-blue/20 border-l-4 border-l-burned-orange/50 bg-navy-blue/[0.03]"
    : "border-navy-blue/20 border-l-4 border-l-navy-blue/40 bg-white";
};

const conditionFieldMessages = {
  tag: "Enter a Dotypos tag.",
  discountGroupId: "Enter or choose a discount group.",
  locales: "Choose at least one locale.",
  from: "Enter a valid start date.",
  to: "Enter a valid end date.",
} as const;

type BuilderContext = {
  readonly errorAt: FilterErrorLookup;
  readonly discountGroups: readonly DiscountGroupOption[] | undefined;
};

export function AudienceFilterBuilder({
  value,
  onChange,
  path,
  errorAt,
  discountGroups,
}: {
  readonly value: AudienceFilterGroup;
  readonly onChange: (value: AudienceFilterGroup) => void;
  /** Form path of the root group, used to look up validation errors. */
  readonly path: string;
  readonly errorAt: FilterErrorLookup;
  /** Dotypos discount groups to pick from; omitted means a free ID input. */
  readonly discountGroups?: readonly DiscountGroupOption[];
}) {
  return (
    <GroupEditor
      group={value}
      onChange={onChange}
      depth={0}
      path={path}
      context={{ errorAt, discountGroups }}
    />
  );
}

function GroupEditor({
  group,
  onChange,
  onRemove,
  depth,
  path,
  context,
}: {
  readonly group: AudienceFilterGroup;
  readonly onChange: (group: AudienceFilterGroup) => void;
  readonly onRemove?: () => void;
  readonly depth: number;
  readonly path: string;
  readonly context: BuilderContext;
}) {
  const setFilters = (filters: readonly AudienceFilter[]) =>
    onChange({ ...group, filters });
  const replaceAt = (index: number, filter: AudienceFilter) =>
    setFilters(
      group.filters.map((current, i) => (i === index ? filter : current))
    );
  const removeAt = (index: number) =>
    setFilters(group.filters.filter((_, i) => i !== index));
  const add = (filter: AudienceFilter) =>
    setFilters([...group.filters, filter]);
  const groupError =
    context.errorAt(path) ?? context.errorAt(`${path}.filters`);

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-3",
        groupFrameClassName(depth)
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={group.operator}
          onValueChange={(operator) => {
            if (operator === "and" || operator === "or") {
              onChange({ ...group, operator });
            }
          }}
          aria-label="How conditions combine"
          className="rounded-md border border-navy-blue/15 p-0.5"
        >
          <ToggleGroupItem value="and">
            {operatorLabels.and.match}
          </ToggleGroupItem>
          <ToggleGroupItem value="or">
            {operatorLabels.or.match}
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="text-navy-blue/60 text-sm">
          {depth === 0 ? "of the following" : "of this group"}
        </span>
        {onRemove ? (
          <RemoveButton label="Remove group" onClick={onRemove} />
        ) : null}
      </div>

      {group.filters.length === 0 ? (
        <p className="rounded-md border border-navy-blue/20 border-dashed px-3 py-2 text-navy-blue/60 text-sm">
          {group.operator === "and"
            ? "No conditions yet, so this matches every known customer."
            : "No conditions yet, so this matches nobody."}
        </p>
      ) : (
        <ol className="space-y-2">
          {group.filters.map((filter, index) => {
            const childPath = `${path}.filters.${index}`;
            return (
              // Nodes are fully controlled and have no identity of their own,
              // so their position is their key.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <li key={index} className="space-y-2">
                {index > 0 ? (
                  <span className="block pl-1 font-semibold text-[0.7rem] text-navy-blue/50 uppercase tracking-[0.12em]">
                    {operatorLabels[group.operator].joiner}
                  </span>
                ) : null}
                {filter._tag === "Group" ? (
                  <GroupEditor
                    group={filter}
                    onChange={(next) => replaceAt(index, next)}
                    onRemove={() => removeAt(index)}
                    depth={depth + 1}
                    path={childPath}
                    context={context}
                  />
                ) : (
                  <ConditionEditor
                    condition={filter}
                    onChange={(next) => replaceAt(index, next)}
                    onRemove={() => removeAt(index)}
                    path={childPath}
                    context={context}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {groupError ? <FieldError message={groupError} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" size="sm">
              <Plus className="h-4 w-4" aria-hidden />
              Add condition
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {Object.values(newConditions).map(({ label, create }) => (
              <DropdownMenuItem key={label} onSelect={() => add(create())}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            add({
              _tag: "Group",
              // A nested group usually flips the parent's logic.
              operator: group.operator === "and" ? "or" : "and",
              filters: [],
            })
          }
        >
          <ListPlus className="h-4 w-4" aria-hidden />
          Add group
        </Button>
      </div>
    </div>
  );
}

function ConditionEditor({
  condition,
  onChange,
  onRemove,
  path,
  context,
}: {
  readonly condition: AudienceCondition;
  readonly onChange: (condition: AudienceCondition) => void;
  readonly onRemove: () => void;
  readonly path: string;
  readonly context: BuilderContext;
}) {
  const fieldError = (field: string) => context.errorAt(`${path}.${field}`);

  const body = Match.value(condition).pipe(
    Match.tagsExhaustive({
      Reservation: (reservation) => (
        <ReservationEditor
          condition={reservation}
          onChange={onChange}
          fieldError={fieldError}
        />
      ),
      Locale: ({ locales: selected }) => (
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm">Speaks</span>
          {locales.map((locale) => {
            const checked = selected.includes(locale);
            const id = `${path}.locales.${locale}`;
            return (
              <label
                key={locale}
                htmlFor={id}
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  // At least one locale stays selected; the schema needs one.
                  disabled={checked && selected.length === 1}
                  onCheckedChange={(next) => {
                    const others = selected.filter((value) => value !== locale);
                    const [first, ...rest] =
                      next === true ? [...others, locale] : others;
                    if (first) {
                      onChange({ _tag: "Locale", locales: [first, ...rest] });
                    }
                  }}
                  className="size-5"
                />
                {localeLabels[locale]}
              </label>
            );
          })}
        </div>
      ),
      DotyposTag: ({ tag }) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Tagged</span>
          <Input
            value={tag}
            onChange={(event) =>
              onChange({ _tag: "DotyposTag", tag: event.target.value })
            }
            placeholder="Dotypos tag"
            aria-label="Dotypos tag"
            variant={fieldError("tag") ? "error" : "default"}
            className={cn(compactInputClassName, "w-56")}
          />
        </div>
      ),
      DiscountGroup: ({ discountGroupId }) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">In discount group</span>
          {context.discountGroups ? (
            <Select
              value={discountGroupId || undefined}
              onValueChange={(next) =>
                onChange({ _tag: "DiscountGroup", discountGroupId: next })
              }
            >
              <SelectTrigger
                aria-label="Discount group"
                variant={fieldError("discountGroupId") ? "error" : "default"}
                className={cn(compactSelectClassName, "min-w-56")}
              >
                <SelectValue placeholder="Choose a discount group" />
              </SelectTrigger>
              <SelectContent>
                {context.discountGroups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={discountGroupId}
              onChange={(event) =>
                onChange({
                  _tag: "DiscountGroup",
                  discountGroupId: event.target.value,
                })
              }
              placeholder="Dotypos discount group ID"
              aria-label="Discount group ID"
              variant={fieldError("discountGroupId") ? "error" : "default"}
              className={cn(compactInputClassName, "w-56")}
            />
          )}
        </div>
      ),
      Account: ({ hasAccount }) => (
        <div className="flex flex-wrap items-center gap-2">
          <PresenceToggle
            value={hasAccount ? "has" : "hasNot"}
            onChange={(presence) =>
              onChange({ _tag: "Account", hasAccount: presence === "has" })
            }
            label="Workspace account"
          />
          <span className="text-sm">a Workspace account</span>
        </div>
      ),
    })
  );

  // The shared filter schema reports raw constraint failures; operators get
  // one plain instruction per invalid field instead.
  const errors = [
    context.errorAt(path),
    ...Object.entries(conditionFieldMessages).map(([field, message]) =>
      fieldError(field) ? message : undefined
    ),
  ].filter((message): message is string => message !== undefined);

  return (
    <div className="flex items-start gap-3 rounded-md border border-navy-blue/15 bg-white px-3 py-2">
      <div className="min-w-0 flex-1 space-y-1">
        <span className="block font-semibold text-[0.7rem] text-navy-blue/55 uppercase tracking-[0.12em]">
          {newConditions[condition._tag].label}
        </span>
        {body}
        {errors.map((message) => (
          <FieldError key={message} message={message} />
        ))}
      </div>
      <RemoveButton label="Remove condition" onClick={onRemove} />
    </div>
  );
}

function ReservationEditor({
  condition,
  onChange,
  fieldError,
}: {
  readonly condition: ReservationCondition;
  readonly onChange: (condition: ReservationCondition) => void;
  readonly fieldError: (field: string) => string | undefined;
}) {
  // Optional criteria are omitted rather than stored empty.
  const setCriteria = (changes: {
    readonly from?: string | undefined;
    readonly to?: string | undefined;
    readonly status?: ReservationStatus | undefined;
  }) => {
    const { from, to, status, ...required } = { ...condition, ...changes };
    let next: ReservationCondition = required;
    if (from) next = { ...next, from };
    if (to) next = { ...next, to };
    if (status) next = { ...next, status };
    onChange(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <PresenceToggle
        value={condition.presence}
        onChange={(presence) => onChange({ ...condition, presence })}
        label="Reservation presence"
      />
      <span className="text-sm">a reservation by</span>
      <ToggleGroup
        type="single"
        value={condition.dateBasis}
        onValueChange={(dateBasis) => {
          if (dateBasis === "visit" || dateBasis === "booking") {
            onChange({ ...condition, dateBasis });
          }
        }}
        aria-label="Date basis"
        className="rounded-md border border-navy-blue/15 p-0.5"
      >
        <ToggleGroupItem value="visit">Visit date</ToggleGroupItem>
        <ToggleGroupItem value="booking">Booking date</ToggleGroupItem>
      </ToggleGroup>
      <LabeledControl label="from">
        <Input
          type="date"
          value={condition.from ?? ""}
          max={condition.to}
          onChange={(event) => setCriteria({ from: event.target.value })}
          aria-label="From date"
          variant={fieldError("from") ? "error" : "default"}
          className={cn(compactInputClassName, "w-40")}
        />
      </LabeledControl>
      <LabeledControl label="to">
        <Input
          type="date"
          value={condition.to ?? ""}
          min={condition.from}
          onChange={(event) => setCriteria({ to: event.target.value })}
          aria-label="To date"
          variant={fieldError("to") ? "error" : "default"}
          className={cn(compactInputClassName, "w-40")}
        />
      </LabeledControl>
      <Select
        value={condition.status ?? anyReservationStatus}
        onValueChange={(status) =>
          setCriteria({
            status: isReservationStatus(status) ? status : undefined,
          })
        }
      >
        <SelectTrigger
          aria-label="Reservation status"
          className={compactSelectClassName}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={anyReservationStatus}>Any status</SelectItem>
          {Object.entries(reservationStatusLabels).map(([status, label]) => (
            <SelectItem key={status} value={status}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PresenceToggle({
  value,
  onChange,
  label,
}: {
  readonly value: "has" | "hasNot";
  readonly onChange: (value: "has" | "hasNot") => void;
  readonly label: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next === "has" || next === "hasNot") onChange(next);
      }}
      aria-label={label}
      className="rounded-md border border-navy-blue/15 p-0.5"
    >
      <ToggleGroupItem value="has">Has</ToggleGroupItem>
      <ToggleGroupItem value="hasNot">Hasn&rsquo;t</ToggleGroupItem>
    </ToggleGroup>
  );
}

function LabeledControl({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2 text-sm">
      {label}
      {children}
    </span>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="ml-auto h-8 w-8 shrink-0 text-navy-blue/55 hover:text-navy-blue"
    >
      <X className="h-4 w-4" aria-hidden />
    </Button>
  );
}

function FieldError({ message }: { readonly message: string }) {
  return (
    <p role="alert" className="text-burned-orange text-sm">
      {message}
    </p>
  );
}
