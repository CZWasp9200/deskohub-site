import type { CustomerCompanyDetails } from "@deskohub/workspace-customer-api";
import { useAtomSet } from "@effect/atom-react";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import { type ReactNode, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../i18n/app-locale";
import { countryName } from "../i18n/country-names";
import { m } from "../i18n/messages";
import { Button } from "../ui/controls";
import { Icon } from "../ui/icon";
import { useLiveRegionAnnouncement } from "../ui/live-announcement";
import { Text } from "../ui/text";
import { color, radius, space } from "../ui/tokens";
import {
  appliedDetails,
  type CompanyDetailsField,
  CompanyLookupState,
  type LookupStatus,
  lookupAction,
  lookupAfterEdit,
  lookupApplied,
  lookupSettled,
  lookupStarted,
  lookupStatus,
} from "./company-lookup-model";
import { companyLookupAtom } from "./company-lookup-request";

/** A form field the registry's details can fill, under the form's own label. */
export interface CompanyLookupField {
  readonly field: CompanyDetailsField;
  readonly label: string;
}

export interface CompanyLookupProps {
  /** What the form's Company ID field holds. */
  readonly companyId: string;
  /** The fields the form has, in its order: the review lists and fills these. */
  readonly fields: ReadonlyArray<CompanyLookupField>;
  /** Puts the found details into the form's draft as typing would; never saves. */
  readonly onApply: (details: Partial<CustomerCompanyDetails>) => void;
  /** The form takes no input now (it is saving); typing by hand stays possible otherwise. */
  readonly disabled: boolean;
  /** The form has a Save button, so the applied state says to press it. */
  readonly remindsToSave: boolean;
  /** Places the lookup button alongside the field it reads when space allows. */
  readonly renderAction?: (action: ReactNode) => ReactNode;
  readonly locale: AppLocale;
}

const actionLabel = {
  "look-up": m.company_lookup_submit,
  retry: m.account_retry,
} as const;

/**
 * Look up company under a form's Company ID field (boards 07b, 13b, 30b):
 * the button, its outcome on the line under it, and a found company's details
 * waiting for Apply to draft or Dismiss. The fields stay editable throughout.
 */
export function CompanyLookup({
  companyId,
  fields,
  onApply,
  disabled,
  remindsToSave,
  renderAction,
  locale,
}: CompanyLookupProps) {
  const [state, setState] = useState<CompanyLookupState>(
    CompanyLookupState.Idle()
  );
  const lookUp = useAtomSet(companyLookupAtom, { mode: "promiseExit" });
  // An edit to another ID drops the lookup at once (state adjusted while
  // rendering), so neither its result nor a late answer comes back with the ID.
  const shown = lookupAfterEdit(state, companyId);
  if (shown !== state) setState(shown);
  const busy = shown._tag === "LookingUp";
  const formFields = fields.map(({ field }) => field);

  const start = () => {
    const started = lookupStarted(companyId);
    setState(started);
    if (started._tag !== "LookingUp") return;
    void lookUp(started.companyId).then((exit) =>
      // Only the lookup still in the state takes its answer: a newer press or
      // an edit to another ID has dropped this one.
      setState((current) =>
        current === started ? lookupSettled(started.companyId, exit) : current
      )
    );
  };

  const action = (
    <Button
      variant="secondary"
      label={(busy ? m.company_lookup_busy : actionLabel[lookupAction(shown)])(
        {},
        { locale }
      )}
      busy={busy}
      disabled={disabled}
      onPress={start}
    />
  );

  return (
    <View style={styles.lookup}>
      {renderAction === undefined ? action : renderAction(action)}
      <LookupStatusLine
        status={lookupStatus(shown, { remindsToSave, locale })}
      />
      {shown._tag === "Found" ? (
        <FoundCompany
          company={shown.company}
          fields={fields}
          disabled={disabled}
          locale={locale}
          onApply={() => {
            onApply(appliedDetails(shown.company, formFields));
            setState(lookupApplied(shown, formFields));
          }}
          onDismiss={() => setState(CompanyLookupState.Idle())}
        />
      ) : null}
    </View>
  );
}

/** The outcome under the button, laid out as a field's error line. */
function LookupStatusLine({
  status,
}: {
  readonly status: LookupStatus | undefined;
}) {
  const live = status?.tone === "danger" ? "assertive" : "polite";
  useLiveRegionAnnouncement(status?.message, live);
  if (status === undefined) return null;
  const positive = status.tone === "positive";
  return (
    <View style={styles.statusRow}>
      <View style={styles.statusIcon}>
        <Icon
          icon={positive ? CircleCheck : CircleAlert}
          size={16}
          color={positive ? color.positiveInk : color.dangerInk}
        />
      </View>
      <Text
        role={positive ? "status" : "alert"}
        aria-live={live}
        accessibilityLiveRegion={live}
        variant="hintStrong"
        tone={status.tone}
        style={styles.statusText}
      >
        {status.message}
      </Text>
    </View>
  );
}

/** The registry's details under the form's labels, to apply or dismiss. */
function FoundCompany({
  company,
  fields,
  disabled,
  locale,
  onApply,
  onDismiss,
}: {
  readonly company: CustomerCompanyDetails;
  readonly fields: ReadonlyArray<CompanyLookupField>;
  readonly disabled: boolean;
  readonly locale: AppLocale;
  readonly onApply: () => void;
  readonly onDismiss: () => void;
}) {
  const rows = fields.flatMap(({ field, label }) => {
    const value = company[field];
    if (value === undefined) return [];
    return [
      {
        field,
        label,
        value: field === "country" ? countryName(value, locale) : value,
      },
    ];
  });
  return (
    <View style={styles.found}>
      <Text variant="label" tone="default">
        {m.company_lookup_review_title({}, { locale })}
      </Text>
      <View style={styles.rows}>
        {rows.map(({ field, label, value }) => (
          <View key={field} style={styles.row}>
            <Text variant="label" tone="default">{`${label}:`}</Text>
            <Text variant="bodySmall" tone="default" style={styles.value}>
              {value}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.actions}>
        <Button
          label={m.company_lookup_apply({}, { locale })}
          size="small"
          width="content"
          disabled={disabled}
          onPress={onApply}
        />
        <Button
          variant="quiet"
          label={m.company_lookup_dismiss({}, { locale })}
          size="small"
          width="content"
          onPress={onDismiss}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lookup: { gap: space.sm },
  statusRow: { alignItems: "flex-start", flexDirection: "row", gap: 6 },
  statusIcon: { marginTop: 1 },
  statusText: { flexShrink: 1, minWidth: 0 },
  found: {
    backgroundColor: color.infoTint,
    borderRadius: radius.group,
    gap: 10,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  rows: { gap: space.xs },
  row: { columnGap: 6, flexDirection: "row", flexWrap: "wrap", minWidth: 0 },
  value: { flexShrink: 1, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
