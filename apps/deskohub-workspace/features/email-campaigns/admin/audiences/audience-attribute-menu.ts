import {
  type AudienceAttribute,
  audienceAttributeCatalogue,
  audienceAttributeSections,
} from "@deskohub/workspace-admin-api";

export const isAudienceAttribute = (
  value: string
): value is AudienceAttribute =>
  Object.hasOwn(audienceAttributeCatalogue, value);

/** The attribute menu: each section with its attributes, in catalogue order. */
export const audienceAttributeMenu = audienceAttributeSections.map(
  (section) => ({
    section,
    attributes: Object.keys(audienceAttributeCatalogue).filter(
      (attribute): attribute is AudienceAttribute =>
        isAudienceAttribute(attribute) &&
        audienceAttributeCatalogue[attribute].section === section
    ),
  })
);
