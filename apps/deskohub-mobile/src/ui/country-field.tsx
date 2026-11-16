import Check from "lucide-react-native/icons/check";
import { useState } from "react";
import type { AppLocale } from "../i18n/app-locale";
import { countryName, invoiceCountries } from "../i18n/country-names";
import { BottomSheet } from "./bottom-sheet";
import { Icon } from "./icon";
import { ListGroup, ListRow } from "./list";
import { SelectField } from "./select-field";
import { color } from "./tokens";

/**
 * An invoice country, picked by name in the app's language from a bottom
 * sheet that ticks the chosen one. The value is the ISO 3166-1 alpha-2 code
 * the Workspace stores; an empty value shows no country. While `disabled`,
 * as during a submit, the field keeps its look and doesn't open.
 */
export function CountryField({
  label,
  value,
  onChange,
  error,
  disabled = false,
  locale,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (code: string) => void;
  readonly error?: string;
  readonly disabled?: boolean;
  readonly locale: AppLocale;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <SelectField
        label={label}
        value={value === "" ? undefined : countryName(value, locale)}
        onPress={() => disabled || setPicking(true)}
        error={error}
      />
      <BottomSheet
        visible={picking}
        title={label}
        onDismiss={() => setPicking(false)}
      >
        {picking && (
          <ListGroup>
            {invoiceCountries(locale).map((option) => (
              <ListRow
                key={option.code}
                label={option.name}
                kind="action"
                trailing={
                  option.code === value ? (
                    <Icon icon={Check} size={20} color={color.action} />
                  ) : (
                    "none"
                  )
                }
                onPress={() => {
                  setPicking(false);
                  onChange(option.code);
                }}
              />
            ))}
          </ListGroup>
        )}
      </BottomSheet>
    </>
  );
}
