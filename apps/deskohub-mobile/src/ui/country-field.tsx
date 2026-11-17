import { type ComponentRef, type Ref, useMemo, useState } from "react";
import type { Pressable } from "react-native";
import type { AppLocale } from "../i18n/app-locale";
import { countryName, invoiceCountries } from "../i18n/country-names";
import { useDeviceCountry } from "../i18n/device-locale";
import { m } from "../i18n/messages";
import { BottomSheet } from "./bottom-sheet";
import { LiveMessage } from "./controls";
import { countryPickerOptions } from "./country-picker-model";
import { ListGroup, ListRow } from "./list";
import { SearchField } from "./search-field";
import { SelectField } from "./select-field";

/**
 * An invoice country, picked by name in the app's language from a bottom
 * sheet (board 07b): a search field that filters the names as the customer
 * types, then the countries, the chosen one first and ticked, then the
 * device's country, Czechia and its neighbours. The value is the ISO 3166-1
 * alpha-2 code the Workspace stores; an empty value shows no country.
 */
export function CountryField({
  label,
  value,
  onChange,
  error,
  disabled = false,
  locale,
  ref,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (code: string) => void;
  readonly error?: string;
  readonly disabled?: boolean;
  readonly locale: AppLocale;
  /** The field, which a form can focus, e.g. when it is invalid. */
  readonly ref?: Ref<ComponentRef<typeof Pressable>>;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const detected = useDeviceCountry();
  return (
    <>
      <SelectField
        label={label}
        value={value === "" ? undefined : countryName(value, locale)}
        onPress={() => {
          // Each opening starts a new search.
          setQuery("");
          setPicking(true);
        }}
        error={error}
        disabled={disabled}
        ref={ref}
      />
      <CountryPickerSheet
        visible={picking}
        title={label}
        query={query}
        onQueryChange={setQuery}
        value={value}
        detected={detected}
        locale={locale}
        onPick={(code) => {
          setPicking(false);
          onChange(code);
        }}
        onDismiss={() => setPicking(false)}
      />
    </>
  );
}

/**
 * The country picker's sheet for a search: the countries
 * `countryPickerOptions` lists, the chosen one ticked, or a status saying
 * no country matches, which assistive tech announces.
 */
export function CountryPickerSheet({
  visible,
  title,
  query,
  onQueryChange,
  value,
  detected,
  locale,
  onPick,
  onDismiss,
}: {
  readonly visible: boolean;
  readonly title: string;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** The chosen country's code; empty while none is chosen. */
  readonly value: string;
  /** The device's country (`detectedCountry`). */
  readonly detected: string;
  readonly locale: AppLocale;
  readonly onPick: (code: string) => void;
  readonly onDismiss: () => void;
}) {
  const countries = useMemo(() => invoiceCountries(locale), [locale]);
  const options = visible
    ? countryPickerOptions({ countries, query, value, detected })
    : [];
  return (
    <BottomSheet
      visible={visible}
      title={title}
      header={
        <SearchField
          placeholder={m.booking_details_country_search({}, { locale })}
          value={query}
          onChangeText={onQueryChange}
        />
      }
      onDismiss={onDismiss}
    >
      {visible && (
        <>
          <LiveMessage
            role="status"
            message={
              options.length === 0
                ? m.booking_details_country_no_match({}, { locale })
                : undefined
            }
          />
          {options.length > 0 && (
            <ListGroup>
              {options.map((option) => (
                <ListRow
                  key={option.code}
                  label={option.name}
                  kind="action"
                  selected={option.code === value}
                  onPress={() => onPick(option.code)}
                />
              ))}
            </ListGroup>
          )}
        </>
      )}
    </BottomSheet>
  );
}
