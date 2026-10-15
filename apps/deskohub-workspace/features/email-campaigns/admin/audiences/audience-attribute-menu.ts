import {
  type AudienceAttribute,
  audienceAttributeCatalogue,
} from "@deskohub/workspace-admin-api";

type AttributeSection = "Reservations" | "Emails" | "Account" | "Profile";

/** How the Admin UI names each catalogued attribute and where it lists it. */
export const audienceAttributeLabels: {
  readonly [Attribute in AudienceAttribute]: {
    readonly label: string;
    readonly section: AttributeSection;
  };
} = {
  reservationCount: { label: "Reservation count", section: "Reservations" },
  lastVisit: { label: "Last visit", section: "Reservations" },
  campaignEmailCount: {
    label: "Campaign emails received",
    section: "Emails",
  },
  hasAccount: { label: "Workspace account", section: "Account" },
  accountCreated: { label: "Account created", section: "Account" },
  locale: { label: "Locale", section: "Profile" },
  dotyposTags: { label: "Dotypos tags", section: "Profile" },
  discountGroup: { label: "Discount group", section: "Profile" },
};

export const isAudienceAttribute = (
  value: string
): value is AudienceAttribute =>
  Object.hasOwn(audienceAttributeCatalogue, value);

const sectionOrder: readonly AttributeSection[] = [
  "Reservations",
  "Emails",
  "Account",
  "Profile",
];

/** The attribute menu: each section with its attributes, in label order. */
export const audienceAttributeSections = sectionOrder.map((section) => ({
  section,
  attributes: Object.entries(audienceAttributeLabels).flatMap(
    ([attribute, labels]) =>
      labels.section === section && isAudienceAttribute(attribute)
        ? [attribute]
        : []
  ),
}));
