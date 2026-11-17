import { useState } from "react";
import { ActionFooter } from "../action-footer";
import { Button, TextField } from "../controls";
import { SearchField } from "../search-field";
import { SelectField } from "../select-field";
import { GalleryCase, GallerySection, useSample } from "./gallery-kit";

const ignore = () => undefined;

/** Board 00c part 5: text fields in every state, the picker and the footer. */
export function FieldsSection() {
  const sample = useSample();
  return (
    <GallerySection title="Text fields">
      <GalleryCase label="Empty, optional, with a hint">
        <TextField
          label={sample("Phone (optional)")}
          placeholder="+420 777 123 456"
          hint={sample("Include the country code.")}
          keyboardType="phone-pad"
        />
      </GalleryCase>
      <GalleryCase label="Filled">
        <TextField label={sample("Last name")} value="Nováková" />
      </GalleryCase>
      {/* Tap to focus: focusing on mount would keep scrolling the gallery
          back to this field. */}
      <GalleryCase label="Focused (tap the field)">
        <TextField label={sample("First name")} value="Jana" />
      </GalleryCase>
      <GalleryCase label="Error">
        <TextField
          label={sample("Company name")}
          value=""
          error={sample("Enter the company name, or choose Personal.")}
        />
      </GalleryCase>
      <GalleryCase label="Read-only">
        <TextField
          label={sample("Login email")}
          value="jana.novakova@example.com"
          readOnly
        />
      </GalleryCase>
      <GalleryCase label="Disabled">
        <TextField label={sample("Company ID")} value="12345678" disabled />
      </GalleryCase>
      <GalleryCase label="Picker">
        <SelectField
          label={sample("Country")}
          value={sample("Czechia")}
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Picker, empty with an error">
        <SelectField
          label={sample("Country")}
          placeholder={sample("Choose a country")}
          error={sample("Choose the country of your address.")}
          onPress={ignore}
        />
      </GalleryCase>
      <GalleryCase label="Search, as a picker sheet's header (board 07b)">
        <SearchSample placeholder={sample("Search countries")} />
      </GalleryCase>
      <GalleryCase label="Action footer, disabled with a neutral reason">
        <ActionFooter message={sample("No changes to save")}>
          <Button label={sample("Save changes")} disabled onPress={ignore} />
        </ActionFooter>
      </GalleryCase>
      <GalleryCase label="Action footer, with an error">
        <ActionFooter
          message={sample("Fix 1 field to save")}
          messageTone="error"
        >
          <Button label={sample("Save changes")} onPress={ignore} />
        </ActionFooter>
      </GalleryCase>
    </GallerySection>
  );
}

function SearchSample({ placeholder }: { readonly placeholder: string }) {
  const [query, setQuery] = useState("");
  return (
    <SearchField
      placeholder={placeholder}
      value={query}
      onChangeText={setQuery}
    />
  );
}
