import Bell from "lucide-react-native/icons/bell";
import Moon from "lucide-react-native/icons/moon";
import { CheckboxRow } from "../checkbox";
import { ChoiceList } from "../choice-list";
import { ListGroup } from "../list";
import { Switch, SwitchRow } from "../switch";
import { GalleryCase, GallerySection, useSample } from "./gallery-kit";

const ignore = () => undefined;

/** Board 00c part 6: radio cards, checkbox rows and switches. */
export function SelectionSection() {
  const sample = useSample();
  return (
    <GallerySection title="Selection controls">
      <GalleryCase label="Radio cards: selected, unselected, disabled">
        <ChoiceList
          label={sample("Billing profile")}
          selected="personal"
          onSelect={ignore}
          choices={[
            {
              value: "personal",
              label: sample("Personal"),
              description: sample("Invoices in your name, with your address."),
            },
            {
              value: "business",
              label: sample("Business"),
              description: sample(
                "Invoices for a company, with its company ID and VAT ID."
              ),
            },
            {
              value: "none",
              label: sample("No billing details"),
              description: sample("Not available for this reservation."),
              disabled: true,
            },
          ]}
        />
      </GalleryCase>
      <GalleryCase label="Checkbox rows: on, off, danger on, disabled">
        <ListGroup>
          <CheckboxRow
            label={sample("Send me news and offers")}
            checked
            onChange={ignore}
          />
          <CheckboxRow
            label={sample("Remember this device")}
            description={sample("Skip the code next time.")}
            checked={false}
            onChange={ignore}
          />
          <CheckboxRow
            label={sample(
              "I understand that my account will be permanently deleted."
            )}
            tone="danger"
            checked
            onChange={ignore}
          />
          <CheckboxRow
            label={sample("Send me news and offers")}
            checked={false}
            disabled
            onChange={ignore}
          />
        </ListGroup>
      </GalleryCase>
      <GalleryCase label="Switch rows: on, off, with an icon, busy, disabled">
        <ListGroup>
          <SwitchRow
            label={sample("Necessary cookies")}
            description={sample("Always on")}
            value
            onValueChange={ignore}
          />
          <SwitchRow
            label={sample("Marketing messages")}
            description={sample("News and offers")}
            value={false}
            onValueChange={ignore}
          />
          <SwitchRow
            label={sample("Reservation reminders")}
            icon={Bell}
            value
            onValueChange={ignore}
          />
          <SwitchRow
            label={sample("Marketing messages")}
            description={sample("Saving…")}
            value
            busy
            onValueChange={ignore}
          />
          <SwitchRow
            label={sample("Analytics")}
            value={false}
            disabled
            onValueChange={ignore}
          />
        </ListGroup>
      </GalleryCase>
      <GalleryCase label="Switch alone: off, on, busy" surface="white">
        <Switch
          value={false}
          onValueChange={ignore}
          accessibilityLabel={sample("Marketing messages")}
        />
        <Switch
          value
          onValueChange={ignore}
          accessibilityLabel={sample("Marketing messages")}
        />
        <Switch
          value={false}
          busy
          onValueChange={ignore}
          accessibilityLabel={sample("Marketing messages")}
        />
      </GalleryCase>
      <GalleryCase
        label="Switch with a label and a thumb icon: off, on"
        surface="white"
      >
        <Switch
          value={false}
          onValueChange={ignore}
          label={sample("Overnight")}
          accessibilityLabel={sample("Overnight")}
          icon={Moon}
        />
        <Switch
          value
          onValueChange={ignore}
          label={sample("Overnight")}
          accessibilityLabel={sample("Overnight")}
          icon={Moon}
        />
      </GalleryCase>
    </GallerySection>
  );
}
